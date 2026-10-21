use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone, Default)]
pub struct GnuGoState(Arc<Mutex<GnuGoRuntime>>);

#[derive(Default)]
struct GnuGoRuntime {
    active: Option<(String, Child)>,
    cancelled: VecDeque<String>,
}

impl GnuGoState {
    fn cancel(&self, request_id: &str) {
        if let Ok(mut runtime) = self.0.lock() {
            // Cancellation can arrive before the blocking worker has spawned.
            runtime.cancelled.push_back(request_id.into());
            if runtime.cancelled.len() > 64 {
                runtime.cancelled.pop_front();
            }
            if runtime
                .active
                .as_ref()
                .is_some_and(|(id, _)| id == request_id)
            {
                if let Some((_, mut child)) = runtime.active.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

// Every exit path (success, protocol error or timeout) terminates the child.
struct ProcessGuard {
    state: GnuGoState,
    request_id: String,
    reader: Option<thread::JoinHandle<()>>,
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        self.state.cancel(&self.request_id);
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefereeRequest {
    request_id: String,
    moves: Vec<RefereeMove>,
    rule_set: String,
    // The frontend supplies points, not Chinese half-area units (zi).
    komi: f64,
}

#[derive(Debug, Deserialize)]
struct RefereeMove {
    player: String,
    coordinate: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefereeResult {
    final_score: String,
    dead_stones: Vec<String>,
    seki_stones: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimateRequest {
    #[serde(flatten)]
    position: RefereeRequest,
    current_player: String,
    #[serde(default)]
    check_readiness: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimateResult {
    // Normalize both the estimate and bounds to Black's perspective.
    score_lead: f64,
    score_lower_bound: f64,
    score_upper_bound: f64,
    influence_regions: Vec<i8>,
    dead_stones: Vec<String>,
    readiness: Option<ScoringReadiness>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoringReadiness {
    ready: bool,
    uncertain_points: usize,
    unresolved_groups: usize,
    black_move: String,
    white_move: String,
    reasons: Vec<String>,
}

fn validate(request: &RefereeRequest) -> Result<&'static str, String> {
    if request.request_id.is_empty() || request.request_id.len() > 128 {
        return Err("Invalid referee request ID".into());
    }
    if !request.komi.is_finite() || request.komi.abs() > 1000.0 {
        return Err("Invalid komi".into());
    }
    let rules = match request.rule_set.as_str() {
        "chinese" => "--chinese-rules",
        "japanese-korean" => "--japanese-rules",
        // GNU Go does not implement AGA-specific scoring adjustments.
        "aga" => {
            return Err(
                "GNU Go does not support AGA adjudication; use Chinese or Japanese rules".into(),
            )
        }
        _ => return Err("Unsupported referee rules".into()),
    };
    if request.moves.len() > 10000 {
        return Err("Too many moves".into());
    }
    for mv in &request.moves {
        if !matches!(mv.player.as_str(), "B" | "W") || !valid_coordinate(&mv.coordinate) {
            return Err("Invalid referee move".into());
        }
    }
    Ok(rules)
}

fn valid_coordinate(coordinate: &str) -> bool {
    if coordinate.eq_ignore_ascii_case("pass") {
        return true;
    }
    let bytes = coordinate.as_bytes();
    if !(2..=3).contains(&bytes.len()) || !b"ABCDEFGHJKLMNOPQRST".contains(&bytes[0]) {
        return false;
    }
    coordinate[1..]
        .parse::<usize>()
        .is_ok_and(|row| (1..=19).contains(&row))
        && bytes[1..].iter().all(u8::is_ascii_digit)
}

fn discover(development: &Path, bundled: &Path) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("GNUGO_EXECUTABLE") {
        let path = PathBuf::from(path);
        return path
            .is_file()
            .then_some(path)
            .ok_or_else(|| "GNUGO_EXECUTABLE is not a file".into());
    }
    let executable = if cfg!(windows) { "gnugo.exe" } else { "gnugo" };
    for root in [development, bundled] {
        let path = root.join("gnugo").join(executable);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("GNU Go is not installed: place it in resources/gnugo or set GNUGO_EXECUTABLE".into())
}

fn read_response(lines: &mpsc::Receiver<String>, deadline: Instant) -> Result<Vec<String>, String> {
    let mut response = Vec::new();
    let mut started = false;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| "GNU Go request timed out".to_string())?;
        let line = lines.recv_timeout(remaining).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => "GNU Go request timed out".to_string(),
            mpsc::RecvTimeoutError::Disconnected => {
                "GNU Go exited or adjudication was cancelled".to_string()
            }
        })?;
        let line = line.trim();
        if !started {
            if let Some(error) = line.strip_prefix('?') {
                return Err(format!("GNU Go rejected command: {}", error.trim()));
            }
            if let Some(value) = line.strip_prefix('=') {
                started = true;
                if !value.trim().is_empty() {
                    response.push(value.trim().to_string());
                }
            }
        } else if line.is_empty() {
            return Ok(response);
        } else {
            response.push(line.to_string());
        }
    }
}

fn with_position<T>(
    state: GnuGoState,
    executable: PathBuf,
    request: RefereeRequest,
    timeout: Duration,
    evaluate: impl FnOnce(&mut dyn FnMut(&str) -> Result<Vec<String>, String>) -> Result<T, String>,
) -> Result<T, String> {
    let rules = validate(&request)?;
    let mut command = Command::new(&executable);
    command
        .args([
            "--mode",
            "gtp",
            "--level",
            "8",
            "--cache-size",
            "8",
            "--seed",
            "0",
            rules,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut active = state
        .0
        .lock()
        .map_err(|_| "Cannot lock GNU Go process".to_string())?;
    if active.cancelled.iter().any(|id| id == &request.request_id) {
        return Err("GNU Go adjudication was cancelled".into());
    }
    if active.active.is_some() {
        return Err("GNU Go is already processing a request".into());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Cannot start GNU Go: {error}"))?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    active.active = Some((request.request_id.clone(), child));
    drop(active);
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
    let _guard = ProcessGuard {
        state,
        request_id: request.request_id.clone(),
        reader: Some(reader),
    };
    let deadline = Instant::now() + timeout;
    let mut send = |command: &str| -> Result<Vec<String>, String> {
        writeln!(stdin, "{command}")
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Cannot write to GNU Go: {error}"))?;
        read_response(&receiver, deadline)
    };
    send("boardsize 19")?;
    send("clear_board")?;
    send(&format!("komi {}", request.komi))?;
    for mv in &request.moves {
        send(&format!("play {} {}", mv.player, mv.coordinate))?;
    }
    evaluate(&mut send)
}

fn adjudicate(
    state: GnuGoState,
    executable: PathBuf,
    request: RefereeRequest,
) -> Result<RefereeResult, String> {
    with_position(
        state,
        executable,
        request,
        Duration::from_secs(120),
        |send| {
            // final_score is the authoritative result. The influence estimate
            // is advisory only and must not veto an otherwise valid terminal
            // position just because its bounds are wide.
            let final_score = send("final_score 0")?.join(" ");
            let dead_stones = send("final_status_list dead 0")?
                .iter()
                .flat_map(|line| line.split_whitespace().map(str::to_string))
                .collect();
            let seki_stones = send("final_status_list seki 0")?
                .iter()
                .flat_map(|line| line.split_whitespace().map(str::to_string))
                .collect();
            Ok(RefereeResult {
                final_score,
                dead_stones,
                seki_stones,
            })
        },
    )
}

fn parse_estimate(value: &str) -> Result<(f64, f64, f64), String> {
    let invalid = || "GNU Go returned an invalid score estimate".to_string();
    let (score, bounds) = value
        .trim()
        .split_once(" (upper bound: ")
        .ok_or_else(invalid)?;
    let (upper, lower) = bounds
        .strip_suffix(')')
        .ok_or_else(invalid)?
        .split_once(", lower: ")
        .ok_or_else(invalid)?;
    let (color, magnitude) = score.split_once('+').ok_or_else(invalid)?;
    let magnitude = magnitude.trim().parse::<f64>().map_err(|_| invalid())?;
    let upper = upper.trim().parse::<f64>().map_err(|_| invalid())?;
    let lower = lower.trim().parse::<f64>().map_err(|_| invalid())?;
    if !matches!(color, "B" | "W")
        || magnitude < 0.0
        || ![magnitude, upper, lower]
            .iter()
            .all(|value| value.is_finite())
        || lower > upper
    {
        return Err(invalid());
    }
    let lead = if color == "B" { magnitude } else { -magnitude };
    // GNU Go's printed bounds are signed White leads, regardless of color label.
    Ok((lead, -upper, -lower))
}

fn parse_regions(lines: Vec<String>) -> Result<Vec<i8>, String> {
    if lines.len() != 19 {
        return Err("GNU Go returned an invalid influence grid".into());
    }
    let mut regions = Vec::with_capacity(361);
    for line in lines {
        let row: Vec<i8> = line
            .split_whitespace()
            .map(str::parse)
            .collect::<Result<_, _>>()
            .map_err(|_| "GNU Go returned an invalid influence value".to_string())?;
        if row.len() != 19 || row.iter().any(|value| !(-4..=4).contains(value)) {
            return Err("GNU Go returned an invalid influence grid".into());
        }
        regions.extend(row);
    }
    Ok(regions)
}

fn estimate(
    state: GnuGoState,
    executable: PathBuf,
    request: EstimateRequest,
) -> Result<EstimateResult, String> {
    if !matches!(request.current_player.as_str(), "B" | "W") {
        return Err("Invalid current player".into());
    }
    with_position(
        state,
        executable,
        request.position,
        Duration::from_secs(30),
        |send| estimate_from_process(send, &request.current_player, request.check_readiness),
    )
}

fn estimate_from_process(
    send: &mut dyn FnMut(&str) -> Result<Vec<String>, String>,
    current_player: &str,
    check_readiness: bool,
) -> Result<EstimateResult, String> {
    let (score_lead, score_lower_bound, score_upper_bound) =
        parse_estimate(&send("estimate_score")?.join(" "))?;
    let influence_regions = parse_regions(send(&format!(
        "initial_influence {current_player} influence_regions"
    ))?)?;
    let dragons = send("dragon_status")?;
    let dead_stones = estimate_dead_stones(send, &dragons)?;
    let readiness = if check_readiness {
        let black_move = send("reg_genmove B")?.join(" ").trim().to_uppercase();
        let white_move = send("reg_genmove W")?.join(" ").trim().to_uppercase();
        Some(scoring_readiness(
            &influence_regions,
            score_lower_bound,
            score_upper_bound,
            dragons,
            black_move,
            white_move,
        )?)
    } else {
        None
    };
    Ok(EstimateResult {
        score_lead,
        score_lower_bound,
        score_upper_bound,
        influence_regions,
        dead_stones,
        readiness,
    })
}

fn estimate_dead_stones(
    send: &mut dyn FnMut(&str) -> Result<Vec<String>, String>,
    dragons: &[String],
) -> Result<Vec<String>, String> {
    let mut dead_stones = Vec::new();
    for dragon in dragons {
        let (coordinate, details) = dragon
            .split_once(':')
            .ok_or("Invalid GNU Go dragon status")?;
        let coordinate = coordinate.trim();
        if !valid_coordinate(coordinate) || coordinate.eq_ignore_ascii_case("pass") {
            return Err("Invalid GNU Go dragon coordinate".into());
        }
        match details.split_whitespace().next() {
            Some("dead") => {
                // Expand the dragon origin to every stone, without simulating the endgame.
                let stones: Vec<String> = send(&format!("dragon_stones {coordinate}"))?
                    .iter()
                    .flat_map(|line| line.split_whitespace().map(str::to_string))
                    .collect();
                if stones.is_empty()
                    || stones.iter().any(|stone| {
                        !valid_coordinate(stone) || stone.eq_ignore_ascii_case("pass")
                    })
                {
                    return Err("Invalid GNU Go dead stones".into());
                }
                for stone in stones {
                    if !dead_stones.contains(&stone) {
                        dead_stones.push(stone);
                    }
                }
            }
            Some("alive" | "critical" | "unknown") => (),
            _ => return Err("Invalid GNU Go dragon status".into()),
        }
    }
    Ok(dead_stones)
}

fn scoring_readiness(
    regions: &[i8],
    lower: f64,
    upper: f64,
    dragons: Vec<String>,
    black_move: String,
    white_move: String,
) -> Result<ScoringReadiness, String> {
    let uncertain_points = regions
        .iter()
        .filter(|value| matches!(value.abs(), 1 | 2))
        .count();
    let mut unresolved_groups = 0;
    for dragon in &dragons {
        let (coordinate, details) = dragon
            .split_once(':')
            .ok_or("Invalid GNU Go dragon status")?;
        let status = details
            .split_whitespace()
            .next()
            .ok_or("Missing GNU Go dragon status")?;
        if !valid_coordinate(coordinate.trim()) || coordinate.trim().eq_ignore_ascii_case("pass") {
            return Err("Invalid GNU Go dragon coordinate".into());
        }
        match status {
            "alive" | "dead" => (),
            "critical" | "unknown" => unresolved_groups += 1,
            _ => return Err("Invalid GNU Go dragon status".into()),
        }
    }
    for mv in [&black_move, &white_move] {
        if !valid_coordinate(mv) {
            return Err("Invalid GNU Go continuation move".into());
        }
    }
    let mut reasons = Vec::new();
    if dragons.is_empty() {
        reasons.push("棋盘尚无可确认的棋块".into());
    }
    if uncertain_points > 0 {
        reasons.push(format!("{uncertain_points} 个区域点归属未定"));
    }
    if unresolved_groups > 0 {
        reasons.push(format!("{unresolved_groups} 个棋块死活未定"));
    }
    if upper - lower > 0.1 {
        reasons.push("目差估值仍有不确定范围".into());
    }
    if black_move != "PASS" {
        reasons.push(format!("黑方仍可继续落子（{black_move}）"));
    }
    if white_move != "PASS" {
        reasons.push(format!("白方仍可继续落子（{white_move}）"));
    }
    Ok(ScoringReadiness {
        ready: reasons.is_empty(),
        uncertain_points,
        unresolved_groups,
        black_move,
        white_move,
        reasons,
    })
}

fn executable_for_app(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources");
    discover(&development, &bundled)
}

#[tauri::command]
pub async fn gnugo_adjudicate(
    app: tauri::AppHandle,
    state: tauri::State<'_, GnuGoState>,
    request: RefereeRequest,
) -> Result<RefereeResult, String> {
    validate(&request)?;
    let executable = executable_for_app(&app)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || adjudicate(state, executable, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn gnugo_estimate(
    app: tauri::AppHandle,
    state: tauri::State<'_, GnuGoState>,
    request: EstimateRequest,
) -> Result<EstimateResult, String> {
    validate(&request.position)?;
    let executable = executable_for_app(&app)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || estimate(state, executable, request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn gnugo_cancel(state: tauri::State<'_, GnuGoState>, request_id: String) {
    state.cancel(&request_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prediction_expands_only_dead_dragons_without_finishing_the_game() {
        let dragons = vec![
            "A1: dead".into(),
            "D4: alive".into(),
            "Q16: critical P16 Q15".into(),
            "T19: unknown".into(),
        ];
        let mut commands = Vec::new();
        let stones = estimate_dead_stones(
            &mut |command| {
                commands.push(command.to_string());
                Ok(vec!["A1 B1".into(), "A2 B1".into()])
            },
            &dragons,
        )
        .unwrap();
        assert_eq!(stones, ["A1", "B1", "A2"]);
        assert_eq!(commands, ["dragon_stones A1"]);
        for invalid in ["A1: invalid", "PASS: dead", "A1\nquit: dead", "A1"] {
            assert!(estimate_dead_stones(&mut |_| panic!("invalid command"), &[invalid.into()]).is_err());
        }
        for stones in [vec![], vec!["PASS".into()], vec!["I1".into()]] {
            assert!(estimate_dead_stones(&mut |_| Ok(stones.clone()), &["A1: dead".into()]).is_err());
        }
    }

    #[test]
    fn scoring_gate_handles_neutral_points_dead_groups_and_remaining_moves() {
        let settled = scoring_readiness(
            &[0, -3, 3, -4, 4],
            1.0,
            1.0,
            vec!["A1: alive".into(), "B1: dead".into()],
            "PASS".into(),
            "PASS".into(),
        )
        .unwrap();
        assert!(settled.ready, "neutral dame alone must not block counting");
        let unsettled = scoring_readiness(
            &[0, -1, 2, 3],
            -2.0,
            3.0,
            vec!["A1: critical B1 C1".into(), "B2: unknown".into()],
            "D4".into(),
            "PASS".into(),
        )
        .unwrap();
        assert!(!unsettled.ready);
        assert_eq!(unsettled.uncertain_points, 2);
        assert_eq!(unsettled.unresolved_groups, 2);
        assert_eq!(unsettled.reasons.len(), 4);
        assert!(
            !scoring_readiness(&[0], 0.0, 0.0, vec![], "PASS".into(), "PASS".into())
                .unwrap()
                .ready
        );
        assert!(scoring_readiness(
            &[0],
            0.0,
            0.0,
            vec!["A1: invalid".into()],
            "PASS".into(),
            "PASS".into()
        )
        .is_err());
    }

    #[test]
    fn advisory_estimate_never_vetoes_authoritative_final_score() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let Ok(executable) = discover(&directory, &directory) else {
            return;
        };
        let state = GnuGoState::default();
        let result = adjudicate(
            state.clone(),
            executable,
            RefereeRequest {
                request_id: "unfinished-test".into(),
                moves: vec![RefereeMove {
                    player: "B".into(),
                    coordinate: "D4".into(),
                }],
                rule_set: "chinese".into(),
                komi: 7.5,
            },
        )
        .unwrap();
        assert!(result.final_score.starts_with('B') || result.final_score.starts_with('W'));
        assert!(state.0.lock().unwrap().active.is_none());
    }

    #[test]
    fn parses_estimate_and_converts_white_bounds_to_black() {
        assert_eq!(
            parse_estimate("W+7.5 (upper bound: 12.5, lower: 2.5)").unwrap(),
            (-7.5, -12.5, -2.5)
        );
        assert_eq!(
            parse_estimate("B+3.0 (upper bound: -1.0, lower: -5.0)").unwrap(),
            (3.0, 1.0, 5.0)
        );
        for value in [
            "",
            "B+NaN (upper bound: 0, lower: 0)",
            "B+1 (upper bound: -2, lower: 2)",
            "W+-3 (upper bound: 0, lower: 0)",
        ] {
            assert!(parse_estimate(value).is_err());
        }
    }

    #[test]
    fn estimate_request_matches_frontend_ipc_shape() {
        let request: EstimateRequest = serde_json::from_value(serde_json::json!({
            "requestId": "ipc-estimate", "moves": [{"player": "B", "coordinate": "D4"}],
            "ruleSet": "chinese", "komi": 7.5, "currentPlayer": "W"
        }))
        .unwrap();
        assert_eq!(request.position.request_id, "ipc-estimate");
        assert_eq!(request.position.moves.len(), 1);
        assert_eq!(request.current_player, "W");
        assert!(validate(&request.position).is_ok());
    }

    #[test]
    fn rejects_malformed_influence_grids() {
        let grid = vec![vec!["-3"; 19].join(" "); 19];
        assert_eq!(parse_regions(grid).unwrap(), vec![-3; 361]);
        assert!(parse_regions(vec!["0".into(); 19]).is_err());
        assert!(parse_regions(vec![vec!["5"; 19].join(" "); 19]).is_err());
        assert!(parse_regions(vec![vec!["0"; 19].join(" "); 18]).is_err());
    }

    #[test]
    fn bundled_engine_estimates_opening_without_finishing_game() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let Ok(executable) = discover(&directory, &directory) else {
            return;
        };
        let state = GnuGoState::default();
        let result = estimate(
            state.clone(),
            executable,
            EstimateRequest {
                position: RefereeRequest {
                    request_id: "estimate-test".into(),
                    moves: vec![RefereeMove {
                        player: "B".into(),
                        coordinate: "D4".into(),
                    }],
                    rule_set: "chinese".into(),
                    komi: 7.5,
                },
                current_player: "W".into(),
                check_readiness: false,
            },
        )
        .unwrap();
        assert!(result.score_lead.is_finite());
        assert!(result.score_lower_bound <= result.score_upper_bound);
        assert_eq!(result.influence_regions.len(), 361);
        assert_eq!(result.influence_regions[15 * 19 + 3], -4);
        assert!(result.dead_stones.is_empty());
        assert!(state.0.lock().unwrap().active.is_none());
    }

    #[test]
    fn bundled_engine_prediction_marks_every_stone_in_dead_groups_of_both_colors() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let Ok(executable) = discover(&directory, &directory) else {
            return;
        };
        let mut moves = Vec::new();
        for (player, coordinates) in [
            ("B", vec!["A3", "B3", "C3", "C2", "C1", "T19", "S19"]),
            ("W", vec!["T17", "S17", "R17", "R18", "R19", "A1", "B1"]),
        ] {
            for coordinate in coordinates {
                moves.push(RefereeMove { player: player.into(), coordinate: coordinate.into() });
            }
        }
        let state = GnuGoState::default();
        let mut result = estimate(
            state.clone(),
            executable,
            EstimateRequest {
                position: RefereeRequest {
                    request_id: "estimate-dead-stones-test".into(), moves,
                    rule_set: "chinese".into(), komi: 7.5,
                },
                current_player: "B".into(), check_readiness: false,
            },
        ).unwrap();
        result.dead_stones.sort();
        assert_eq!(result.dead_stones, ["A1", "B1", "S19", "T19"]);
        assert!(result.readiness.is_none());
        assert!(state.0.lock().unwrap().active.is_none());
    }

    #[test]
    fn rejects_current_player_protocol_injection() {
        let error = estimate(
            GnuGoState::default(),
            PathBuf::from("not-an-engine"),
            EstimateRequest {
                position: RefereeRequest {
                    request_id: "invalid-player".into(),
                    moves: vec![],
                    rule_set: "chinese".into(),
                    komi: 7.5,
                },
                current_player: "W\nquit".into(),
                check_readiness: true,
            },
        )
        .unwrap_err();
        assert!(error.contains("Invalid current player"));
    }

    #[test]
    fn validates_coordinates_and_blocks_protocol_injection() {
        for coordinate in ["A1", "T19", "J10", "pass"] {
            assert!(valid_coordinate(coordinate));
        }
        for coordinate in ["I1", "A0", "T20", "A1\nquit", "Ａ1", "resign", ""] {
            assert!(!valid_coordinate(coordinate));
        }
    }

    #[test]
    fn reads_multiline_gtp_and_errors() {
        let (tx, rx) = mpsc::channel();
        for line in ["= A1 A2", "B3", ""] {
            tx.send(line.into()).unwrap();
        }
        assert_eq!(
            read_response(&rx, Instant::now() + Duration::from_secs(1)).unwrap(),
            ["A1 A2", "B3"]
        );
        tx.send("? illegal move".into()).unwrap();
        assert!(read_response(&rx, Instant::now() + Duration::from_secs(1))
            .unwrap_err()
            .contains("illegal move"));
    }

    #[test]
    fn rejects_unsupported_rules() {
        let request = RefereeRequest {
            request_id: "test".into(),
            moves: vec![],
            rule_set: "aga".into(),
            komi: 7.5,
        };
        assert!(validate(&request).is_err());
    }

    #[test]
    fn bundled_engine_scores_without_changing_input_and_cleans_up() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let Ok(executable) = discover(&directory, &directory) else {
            return;
        };
        let state = GnuGoState::default();
        let mut moves = Vec::new();
        // One connected black group with two separated eyes is already settled.
        for row in 1..=19 {
            for &letter in b"ABCDEFGHJKLMNOPQRST" {
                if row == 1 && matches!(letter, b'A' | b'C') {
                    continue;
                }
                moves.push(RefereeMove {
                    player: "B".into(),
                    coordinate: format!("{}{row}", letter as char),
                });
            }
        }
        moves.push(RefereeMove {
            player: "W".into(),
            coordinate: "pass".into(),
        });
        moves.push(RefereeMove {
            player: "B".into(),
            coordinate: "pass".into(),
        });
        let result = adjudicate(
            state.clone(),
            executable,
            RefereeRequest {
                request_id: "integration-test".into(),
                moves,
                rule_set: "chinese".into(),
                komi: 7.5,
            },
        )
        .unwrap();
        assert_eq!(result.final_score, "B+353.5");
        assert!(result.dead_stones.is_empty());
        assert!(state.0.lock().unwrap().active.is_none());
    }

    #[test]
    fn cancellation_before_spawn_does_not_start_engine() {
        let state = GnuGoState::default();
        state.cancel("cancelled-request");
        let error = adjudicate(
            state.clone(),
            PathBuf::from("not-an-engine"),
            RefereeRequest {
                request_id: "cancelled-request".into(),
                moves: vec![],
                rule_set: "chinese".into(),
                komi: 7.5,
            },
        )
        .unwrap_err();
        assert!(error.contains("cancelled"));
        assert!(state.0.lock().unwrap().active.is_none());
    }

    #[test]
    fn cancellation_terminates_running_engine() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let Ok(executable) = discover(&directory, &directory) else {
            return;
        };
        let state = GnuGoState::default();
        let worker_state = state.clone();
        let worker = thread::spawn(move || {
            adjudicate(
                worker_state,
                executable,
                RefereeRequest {
                    request_id: "running-request".into(),
                    moves: vec![],
                    rule_set: "chinese".into(),
                    komi: 7.5,
                },
            )
        });
        for _ in 0..100 {
            if state.0.lock().unwrap().active.is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(state.0.lock().unwrap().active.is_some());
        state.cancel("old-request");
        assert!(state.0.lock().unwrap().active.is_some());
        state.cancel("running-request");
        assert!(worker.join().unwrap().is_err());
        assert!(state.0.lock().unwrap().active.is_none());
    }
}
