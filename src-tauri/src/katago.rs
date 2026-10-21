use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::State;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone)]
pub struct KataGoState {
    move_process: Arc<Mutex<Option<KataGoProcess>>>,
    analysis_process: Arc<Mutex<Option<KataGoProcess>>>,
    final_process: Arc<Mutex<Option<GtpProcess>>>,
    gpu_lock: Arc<Mutex<()>>,
    analysis_cancel: Arc<AtomicBool>,
    ai_active: Arc<AtomicBool>,
    runtime: Option<EngineRuntime>,
    configuration_error: Option<String>,
    data_dir: PathBuf,
    warming: Arc<AtomicBool>,
    last_error: Arc<Mutex<Option<String>>>,
}

impl KataGoState {
    pub fn new(
        runtime: Option<EngineRuntime>,
        configuration_error: Option<String>,
        data_dir: PathBuf,
    ) -> Self {
        Self {
            move_process: Arc::new(Mutex::new(None)),
            analysis_process: Arc::new(Mutex::new(None)),
            final_process: Arc::new(Mutex::new(None)),
            gpu_lock: Arc::new(Mutex::new(())),
            analysis_cancel: Arc::new(AtomicBool::new(false)),
            ai_active: Arc::new(AtomicBool::new(false)),
            runtime,
            configuration_error,
            data_dir,
            warming: Arc::new(AtomicBool::new(false)),
            last_error: Arc::new(Mutex::new(None)),
        }
    }

    pub fn warmup(&self) -> Result<(), String> {
        if self.runtime.is_none() {
            return Err(self
                .configuration_error
                .clone()
                .unwrap_or_else(|| "KataGo 未配置".to_string()));
        }
        if self.warming.swap(true, Ordering::AcqRel) {
            return Ok(());
        }

        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = None;
        }

        let result = (|| {
            let runtime = self
                .runtime
                .as_ref()
                .ok_or_else(|| "KataGo 未配置".to_string())?;
            let _gpu_guard = self
                .gpu_lock
                .lock()
                .map_err(|_| "无法锁定 GPU 分析调度器".to_string())?;
            let mut slot = self
                .move_process
                .lock()
                .map_err(|_| "无法锁定 KataGo 进程".to_string())?;
            let request = AnalyzeRequest {
                moves: Vec::new(),
                mode: "fast".to_string(),
                strength: "beginner".to_string(),
                max_visits: None,
                human_profile: None,
                rule_set: "chinese".to_string(),
                komi: 7.5,
                handicap: 0,
                initial_stones: None,
                initial_player: None,
                board_size: None,
                search_profile: None,
            };
            run_analysis(runtime, &self.data_dir, &mut slot, request, true, None).map(|_| ())
        })();

        self.warming.store(false, Ordering::Release);
        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = result.as_ref().err().cloned();
        }
        result
    }
}

#[derive(Clone, Debug)]
pub(crate) struct EngineRuntime {
    executable: PathBuf,
    executable_dir: PathBuf,
    model: PathBuf,
    config: PathBuf,
    human_model: Option<PathBuf>,
    profile_name: String,
}

enum StdoutMsg {
    Line(String),
    Eof,
}

struct KataGoProcess {
    child: Child,
    stdin: ChildStdin,
    stdout_rx: Receiver<StdoutMsg>,
    reader_thread: Option<thread::JoinHandle<()>>,
    request_id: u64,
}

impl Drop for KataGoProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader_thread.take() {
            let _ = reader.join();
        }
    }
}

struct GtpProcess {
    child: Child,
    stdin: ChildStdin,
    stdout_rx: Receiver<StdoutMsg>,
    reader_thread: Option<thread::JoinHandle<()>>,
}

impl Drop for GtpProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader_thread.take() {
            let _ = reader.join();
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    moves: Vec<GtpMove>,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default = "default_strength")]
    strength: String,
    #[serde(default)]
    max_visits: Option<u32>,
    #[serde(default)]
    human_profile: Option<String>,
    #[serde(default = "default_rules")]
    rule_set: String,
    #[serde(default = "default_komi")]
    komi: f64,
    #[serde(default)]
    handicap: usize,
    #[serde(default)]
    initial_stones: Option<Vec<GtpMove>>,
    #[serde(default)]
    initial_player: Option<String>,
    #[serde(default)]
    board_size: Option<usize>,
    #[serde(default)]
    search_profile: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalScoreRequest {
    moves: Vec<GtpMove>,
    #[serde(default = "default_rules")]
    rule_set: String,
    #[serde(default = "default_komi")]
    komi: f64,
}

fn default_mode() -> String {
    "fast".to_string()
}
fn default_strength() -> String {
    "normal".to_string()
}
fn default_rules() -> String {
    "chinese".to_string()
}
fn default_komi() -> f64 {
    7.5
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GtpMove {
    player: String,
    coordinate: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub configured: bool,
    pub running: bool,
    pub warming: bool,
    pub detail: String,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KataGoAnalysis {
    pub turn_number: u32,
    pub root_info: RootInfo,
    pub move_infos: Vec<MoveInfo>,
    pub ownership: Vec<f64>,
    pub ownership_stdev: Vec<f64>,
    pub human_policy: Vec<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalScoreResult {
    pub final_score: String,
    pub dead_stones: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub current_player: String,
    pub visits: u32,
    pub winrate: f64,
    pub score_lead: f64,
    pub score_stdev: f64,
    pub utility: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MoveInfo {
    pub r#move: String,
    pub visits: u32,
    pub winrate: f64,
    pub score_lead: f64,
    pub score_stdev: f64,
    pub utility: f64,
    pub play_selection_value: f64,
    pub order: u32,
    pub prior: f64,
    #[serde(default)]
    pub human_prior: Option<f64>,
    pub pv: Vec<String>,
    pub is_symmetry_of: Option<String>,
}

struct AnalyzeParams {
    target_visits: u32,
    timeout: Duration,
}

fn analyze_params(mode: &str, strength: &str) -> AnalyzeParams {
    if mode == "deep" {
        return AnalyzeParams {
            target_visits: 5000,
            timeout: Duration::from_secs(30),
        };
    }
    let (target_visits, timeout) = match strength {
        "beginner" => (50, Duration::from_secs(10)),
        "casual" => (200, Duration::from_secs(10)),
        "normal" => (800, Duration::from_secs(15)),
        "strong" => (3000, Duration::from_secs(25)),
        "expert" => (10000, Duration::from_secs(45)),
        _ => (800, Duration::from_secs(15)),
    };
    AnalyzeParams {
        target_visits,
        timeout,
    }
}

fn human_profile_rank(profile: &str) -> Option<(u32, bool)> {
    let normalized = profile.to_ascii_lowercase();
    let dan = normalized.ends_with('d');
    if !dan && !normalized.ends_with('k') {
        return None;
    }
    normalized[..normalized.len() - 1]
        .rsplit('_')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|rank| (1..=20).contains(rank))
        .map(|rank| (rank, dan))
}

fn human_profile_rank_progress(profile: &str) -> Option<f64> {
    let (rank, dan) = human_profile_rank(profile)?;
    Some(if dan {
        (19 + rank) as f64 / 28.0
    } else {
        (20 - rank) as f64 / 28.0
    })
}

fn human_profile_search_progress(profile: &str) -> Option<f64> {
    human_profile_rank_progress(profile).map(|progress| progress.powf(1.5))
}

fn human_profile_visits(mode: &str, profile: &str) -> u32 {
    if mode == "deep" {
        return 5000;
    }
    let Some(progress) = human_profile_rank_progress(profile) else {
        return 1;
    };
    (40.0 + (1200.0 - 40.0) * progress.powi(2)).round() as u32
}

fn human_sl_settings(profile: &str) -> Value {
    let progress = human_profile_search_progress(profile).unwrap_or(0.0);
    let root_explore = progress * 0.8;
    let cpuct = 0.2 + progress * 1.8;
    json!({
        "humanSLProfile": profile,
        "ignorePreRootHistory": false,
        "rootNumSymmetriesToSample": 2,
        "humanSLRootExploreProbWeightless": root_explore,
        "humanSLRootExploreProbWeightful": 0.0,
        "humanSLCpuctPermanent": cpuct,
        "useUncertainty": false,
        "subtreeValueBiasFactor": 0.0,
        "useNoisePruning": false,
    })
}

fn target_visits(request: &AnalyzeRequest, params: &AnalyzeParams) -> u32 {
    request
        .max_visits
        .or_else(|| {
            request
                .human_profile
                .as_deref()
                .map(|profile| human_profile_visits(&request.mode, profile))
        })
        .unwrap_or(params.target_visits)
        .clamp(1, 100_000)
}

fn analyze_with_process(
    process: &mut KataGoProcess,
    request: AnalyzeRequest,
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Result<KataGoAnalysis, String> {
    process.request_id += 1;
    let request_id = process.request_id.to_string();
    let params = analyze_params(&request.mode, &request.strength);
    let target_visits = target_visits(&request, &params);
    let response_timeout = if process.request_id == 1 {
        params.timeout + Duration::from_secs(120)
    } else {
        timeout.min(params.timeout.max(Duration::from_secs(10)))
    };
    let turn_number = request.moves.len();
    let human_profile = request.human_profile.clone();
    let (default_initial_stones, moves, default_current_player, _) =
        split_opening_sequence(request.moves, request.handicap);
    let initial_stones = request
        .initial_stones
        .map(|stones| {
            stones
                .into_iter()
                .map(|mv| [mv.player.to_uppercase(), mv.coordinate.to_uppercase()])
                .collect::<Vec<[String; 2]>>()
        })
        .unwrap_or(default_initial_stones);
    let custom_initial_player = request.initial_player.is_some();
    let (initial_player, current_player) = analysis_players(
        &moves,
        request.initial_player.as_deref(),
        default_current_player,
    );
    let board_size = request.board_size.unwrap_or(19);
    if ![9, 13, 19].contains(&board_size) {
        return Err("仅支持 9、13、19 路棋盘".to_string());
    }
    let analysis_turn = moves.len();
    let mut query = json!({
        "id": request_id,
        "moves": moves,
        "initialStones": initial_stones,
        "rules": request.rule_set,
        "komi": kata_go_komi(request.komi)?,
        "boardXSize": board_size,
        "boardYSize": board_size,
        "analyzeTurns": [analysis_turn],
        "maxVisits": target_visits,
        "includePolicy": true,
        "includeOwnership": true,
        "includeOwnershipStdev": true
    });
    if request.handicap > 0 || custom_initial_player {
        query["initialPlayer"] = json!(initial_player);
    }
    let mut override_settings = serde_json::Map::new();
    if let Some(profile) = human_profile.as_deref() {
        if let Some(settings) = human_sl_settings(profile).as_object() {
            override_settings.extend(settings.clone());
        }
    }
    if request.search_profile.as_deref() == Some("recommendation") {
        // Recommendation search should favor best-move accuracy over the
        // wider candidate coverage used by general study analysis.
        override_settings.insert("wideRootNoise".to_string(), json!(0.0));
    }
    if !override_settings.is_empty() {
        query["overrideSettings"] = Value::Object(override_settings);
    }
    send_json(&mut process.stdin, &query)?;
    let response = read_analysis_response(process, &request_id, response_timeout, cancel)?;
    if response.ownership.len() != board_size * board_size {
        return Err("KataGo 未返回完整 ownership 数据".to_string());
    }
    if human_profile.is_some() && response.human_policy.len() != board_size * board_size + 1 {
        return Err("KataGo 未返回完整 Human SL policy 数据".to_string());
    }
    let mut move_infos = response.move_infos;
    move_infos.sort_by_key(|info| info.order);
    let mut root_info = response.root_info;
    if root_info.current_player.is_empty() {
        root_info.current_player = current_player;
    }
    Ok(KataGoAnalysis {
        turn_number: turn_number as u32,
        root_info,
        move_infos,
        ownership: response.ownership,
        ownership_stdev: if response.ownership_stdev.len() == board_size * board_size {
            response.ownership_stdev
        } else {
            vec![0.0; board_size * board_size]
        },
        human_policy: response.human_policy,
    })
}

fn find_katago_executable(runtime_dir: &Path) -> Option<PathBuf> {
    let path = runtime_dir.join("katago.exe");
    path.is_file().then_some(path)
}

fn find_model(runtime_dir: &Path) -> Option<PathBuf> {
    let names = [
        "model.bin.gz",
        "kata1-b40c256-s11840935168-d289884567.bin.gz",
        "g170e-b20c256x2-s2430231552-d525879064.bin.gz",
    ];
    for name in names {
        let path = runtime_dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    std::fs::read_dir(runtime_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_lowercase().ends_with(".bin.gz"))
                .unwrap_or(false)
        })
}

fn find_analysis_config(runtime_dir: &Path) -> Option<PathBuf> {
    [
        "analysis.cfg",
        "estimate.cfg",
        "analysis_example.cfg",
        "default_gtp.cfg",
    ]
    .into_iter()
    .map(|name| runtime_dir.join(name))
    .find(|path| path.is_file())
}

fn find_human_model(development_resources: &Path, bundled_resources: &Path) -> Option<PathBuf> {
    [development_resources, bundled_resources]
        .into_iter()
        .map(|resources| {
            resources
                .join("katago-human")
                .join("b18c384nbt-humanv0.bin.gz")
        })
        .find(|path| path.is_file())
}

fn profile_name(profile_dir: &Path) -> String {
    match profile_dir.file_name().and_then(|name| name.to_str()) {
        Some("katago-estimate") => "estimate".to_string(),
        Some("katago") => "standard".to_string(),
        Some(name) => name.to_string(),
        None => "unknown".to_string(),
    }
}

fn profile_is_usable(profile_dir: &Path) -> bool {
    find_model(profile_dir).is_some() && find_analysis_config(profile_dir).is_some()
}

fn profile_candidates(development_resources: &Path, bundled_resources: &Path) -> Vec<PathBuf> {
    vec![
        development_resources.join("katago-estimate"),
        development_resources.join("katago"),
        bundled_resources.join("katago-estimate"),
        bundled_resources.join("katago"),
    ]
}

fn runtime_candidates(development_resources: &Path, bundled_resources: &Path) -> Vec<PathBuf> {
    // The standard directory is the canonical shared runtime. An estimate
    // directory is accepted only when it is independently runnable.
    vec![
        development_resources.join("katago"),
        development_resources.join("katago-estimate"),
        bundled_resources.join("katago"),
        bundled_resources.join("katago-estimate"),
    ]
}

fn select_profile_dir(development_resources: &Path, bundled_resources: &Path) -> Option<PathBuf> {
    profile_candidates(development_resources, bundled_resources)
        .into_iter()
        .find(|directory| profile_is_usable(directory))
}

fn configured(runtime: &EngineRuntime) -> bool {
    runtime.executable.is_file() && runtime.model.is_file() && runtime.config.is_file()
}

fn probe_runtime(executable: &Path, executable_dir: &Path) -> Result<(), String> {
    let mut command = Command::new(executable);
    command
        .arg("version")
        .current_dir(executable_dir)
        .env("PATH", process_path(executable_dir)?);
    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let output = command
        .output()
        .map_err(|error| format!("无法探测 KataGo 运行时：{error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let code = output
        .status
        .code()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stderr.is_empty() {
        "可能缺少 TensorRT/CUDA DLL".to_string()
    } else {
        stderr
    };
    Err(format!("退出码 {code}：{detail}"))
}

pub(crate) fn discover_runtime(
    development_resources: &Path,
    bundled_resources: &Path,
) -> Result<EngineRuntime, String> {
    let mut runtime_errors = Vec::new();
    let executable_dir = runtime_candidates(development_resources, bundled_resources)
        .into_iter()
        .filter_map(|directory| {
            let executable = find_katago_executable(&directory)?;
            match probe_runtime(&executable, &directory) {
                Ok(()) => Some(directory),
                Err(error) => {
                    runtime_errors.push(format!("{}：{error}", directory.display()));
                    None
                }
            }
        })
        .next()
        .ok_or_else(|| {
            if runtime_errors.is_empty() {
                "未找到可用的 KataGo 运行时（缺少 katago.exe）".to_string()
            } else {
                format!("未找到可用的 KataGo 运行时：{}", runtime_errors.join("；"))
            }
        })?;

    let profile_dir = select_profile_dir(development_resources, bundled_resources)
        .ok_or_else(|| "未找到可用的 KataGo 模型和分析配置".to_string())?;
    let executable = find_katago_executable(&executable_dir)
        .ok_or_else(|| "已探测的 KataGo 运行时缺少 katago.exe".to_string())?;
    let model =
        find_model(&profile_dir).ok_or_else(|| "已选择的 KataGo 配置档缺少模型文件".to_string())?;
    let config = find_analysis_config(&profile_dir)
        .ok_or_else(|| "已选择的 KataGo 配置档缺少分析配置".to_string())?;
    let human_model = find_human_model(development_resources, bundled_resources);

    Ok(EngineRuntime {
        executable,
        executable_dir,
        model,
        config,
        human_model,
        profile_name: profile_name(&profile_dir),
    })
}

fn process_path(runtime_dir: &Path) -> Result<std::ffi::OsString, String> {
    let mut paths = vec![runtime_dir.to_path_buf()];
    if let Some(cuda_root) = env::var_os("CUDA_PATH") {
        paths.push(PathBuf::from(cuda_root).join("bin"));
    } else {
        let installed_cuda =
            PathBuf::from(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.2\bin");
        if installed_cuda.is_dir() {
            paths.push(installed_cuda);
        }
    }
    paths.extend(env::split_paths(&env::var_os("PATH").unwrap_or_default()));
    env::join_paths(paths).map_err(|error| format!("无法构建 KataGo PATH: {error}"))
}

fn config_path(path: &Path) -> String {
    path.display().to_string().replace('\\', "/")
}

fn start_stdout_reader(stdout: ChildStdout) -> (Receiver<StdoutMsg>, thread::JoinHandle<()>) {
    let (tx, rx) = mpsc::channel();
    let handle = thread::Builder::new()
        .name("katago-analysis-stdout".into())
        .spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        let _ = tx.send(StdoutMsg::Eof);
                        break;
                    }
                    Ok(_) => {
                        let line = line.trim_end_matches(['\r', '\n']).to_string();
                        if tx.send(StdoutMsg::Line(line)).is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        let _ = tx.send(StdoutMsg::Eof);
                        break;
                    }
                }
            }
        })
        .expect("failed to spawn KataGo stdout reader thread");
    (rx, handle)
}

fn start_process(
    runtime: &EngineRuntime,
    data_dir: &Path,
    use_human_model: bool,
) -> Result<KataGoProcess, String> {
    let home_data = data_dir.join("KataGoData");
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&home_data).map_err(|e| format!("无法创建 KataGo 数据目录: {e}"))?;
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("无法创建 KataGo 日志目录: {e}"))?;
    let stderr_path = data_dir.join("katago-stderr.log");
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(stderr_path)
        .map_err(|e| format!("无法创建引擎日志: {e}"))?;
    let override_cfg = format!(
        // Human SL tiering relies on visit counts being comparable. Multiple
        // search threads make one visit schedule several neural evaluations and
        // weaken low-visit searches, so game moves deliberately use one thread.
        "homeDataDir={},logDir={},logToStderr=false,reportAnalysisWinratesAs=BLACK{}",
        config_path(&home_data),
        config_path(&log_dir),
        if use_human_model {
            ",numAnalysisThreads=1,numSearchThreadsPerAnalysisThread=1"
        } else {
            ""
        }
    );

    let mut command = Command::new(&runtime.executable);
    command.arg("analysis").arg("-model").arg(&runtime.model);
    if use_human_model {
        let human_model = runtime
            .human_model
            .as_ref()
            .ok_or_else(|| "Human SL 模型未配置，请检查 resources/katago-human".to_string())?;
        command.arg("-human-model").arg(human_model);
    }
    command
        .arg("-config")
        .arg(&runtime.config)
        .arg("-override-config")
        .arg(&override_cfg)
        .current_dir(&runtime.executable_dir)
        .env("PATH", process_path(&runtime.executable_dir)?);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    command.creation_flags(0x08000000);

    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 KataGo: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接 KataGo 输入流".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法连接 KataGo 输出流".to_string())?;
    let (stdout_rx, reader_thread) = start_stdout_reader(stdout);
    Ok(KataGoProcess {
        child,
        stdin,
        stdout_rx,
        reader_thread: Some(reader_thread),
        request_id: 0,
    })
}

fn ensure_process<'a>(
    slot: &'a mut Option<KataGoProcess>,
    runtime: &EngineRuntime,
    data_dir: &Path,
    use_human_model: bool,
) -> Result<&'a mut KataGoProcess, String> {
    let needs_restart = match slot.as_mut() {
        Some(process) => process
            .child
            .try_wait()
            .map(|status| status.is_some())
            .unwrap_or(true),
        None => true,
    };
    if needs_restart {
        *slot = Some(start_process(runtime, data_dir, use_human_model)?);
    }
    slot.as_mut().ok_or_else(|| "KataGo 进程不可用".to_string())
}

fn send_json(stdin: &mut ChildStdin, request: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stdin, request)
        .map_err(|e| format!("无法序列化 KataGo 请求: {e}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("无法发送 KataGo 请求: {e}"))?;
    stdin
        .flush()
        .map_err(|e| format!("无法提交 KataGo 请求: {e}"))
}

fn send_gtp(stdin: &mut ChildStdin, command: &str) -> Result<(), String> {
    stdin
        .write_all(command.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("无法发送 KataGo GTP 命令: {error}"))
}

fn read_gtp_response(process: &mut GtpProcess, timeout: Duration) -> Result<Vec<String>, String> {
    let deadline = std::time::Instant::now() + timeout;
    let mut lines = Vec::new();
    let mut started = false;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!("KataGo GTP 响应超时 ({timeout:?})"));
        }
        match process
            .stdout_rx
            .recv_timeout(remaining.min(Duration::from_millis(100)))
        {
            Ok(StdoutMsg::Line(line)) => {
                if !started {
                    if line.is_empty() {
                        continue;
                    }
                    started = true;
                }
                if line.is_empty() {
                    return Ok(lines);
                }
                let normalized = line.trim_start_matches(['=', '?']).trim().to_string();
                if line.starts_with('?') {
                    return Err(if normalized.is_empty() {
                        "KataGo GTP 命令失败".into()
                    } else {
                        normalized
                    });
                }
                lines.push(normalized);
            }
            Ok(StdoutMsg::Eof) => return Err("KataGo GTP 进程意外退出".into()),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return Err("KataGo GTP 输出管道已断开".into()),
        }
    }
}

fn start_gtp_process(runtime: &EngineRuntime, data_dir: &Path) -> Result<GtpProcess, String> {
    let home_data = data_dir.join("KataGoData");
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&home_data)
        .map_err(|error| format!("无法创建引擎数据目录: {error}"))?;
    std::fs::create_dir_all(&log_dir).map_err(|error| format!("无法创建引擎日志目录: {error}"))?;
    let stderr_path = data_dir.join("katago-gtp-stderr.log");
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(stderr_path)
        .map_err(|error| format!("无法创建 GTP 引擎日志: {error}"))?;
    let override_cfg = format!(
        "homeDataDir={},logDir={},logToStderr=false",
        config_path(&home_data),
        config_path(&log_dir)
    );
    let gtp_config = {
        let default_config = runtime.executable_dir.join("default_gtp.cfg");
        if default_config.is_file() {
            default_config
        } else {
            runtime.config.clone()
        }
    };
    let mut command = Command::new(&runtime.executable);
    command
        .arg("gtp")
        .arg("-model")
        .arg(&runtime.model)
        .arg("-config")
        .arg(&gtp_config)
        .arg("-override-config")
        .arg(&override_cfg)
        .current_dir(&runtime.executable_dir)
        .env("PATH", process_path(&runtime.executable_dir)?);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 KataGo GTP: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法连接 KataGo GTP 输入流".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法连接 KataGo GTP 输出流".to_string())?;
    let (stdout_rx, reader_thread) = start_stdout_reader(stdout);
    Ok(GtpProcess {
        child,
        stdin,
        stdout_rx,
        reader_thread: Some(reader_thread),
    })
}

fn run_final_score_with_process(
    process: &mut GtpProcess,
    request: FinalScoreRequest,
) -> Result<FinalScoreResult, String> {
    send_gtp(&mut process.stdin, "boardsize 19")?;
    // TensorRT builds the network and timing cache lazily on the first command.
    read_gtp_response(process, Duration::from_secs(120))?;
    let command_timeout = Duration::from_secs(10);
    send_gtp(
        &mut process.stdin,
        &format!("kata-set-rules {}", request.rule_set),
    )?;
    read_gtp_response(process, command_timeout)?;
    send_gtp(
        &mut process.stdin,
        &format!("komi {}", kata_go_komi(request.komi)?),
    )?;
    read_gtp_response(process, command_timeout)?;
    send_gtp(&mut process.stdin, "clear_board")?;
    read_gtp_response(process, command_timeout)?;
    for mv in request.moves {
        let player =
            if mv.player.eq_ignore_ascii_case("white") || mv.player.eq_ignore_ascii_case("w") {
                "W"
            } else {
                "B"
            };
        send_gtp(
            &mut process.stdin,
            &format!("play {player} {}", mv.coordinate),
        )?;
        read_gtp_response(process, command_timeout)?;
    }
    send_gtp(&mut process.stdin, "final_status_list dead")?;
    let dead_stones = read_gtp_response(process, Duration::from_secs(30))?
        .into_iter()
        .flat_map(|line| {
            line.split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|coordinate| !coordinate.eq_ignore_ascii_case("pass"))
        .collect();
    send_gtp(&mut process.stdin, "final_score")?;
    let final_score = read_gtp_response(process, Duration::from_secs(30))?
        .into_iter()
        .next()
        .ok_or_else(|| "KataGo 未返回最终分数".to_string())?;
    Ok(FinalScoreResult {
        final_score,
        dead_stones,
    })
}

fn run_final_score(
    runtime: &EngineRuntime,
    data_dir: &Path,
    slot: &mut Option<GtpProcess>,
    request: FinalScoreRequest,
) -> Result<FinalScoreResult, String> {
    let needs_restart = match slot.as_mut() {
        Some(process) => process
            .child
            .try_wait()
            .map(|status| status.is_some())
            .unwrap_or(true),
        None => true,
    };
    if needs_restart {
        *slot = Some(start_gtp_process(runtime, data_dir)?);
    }
    let process = slot
        .as_mut()
        .ok_or_else(|| "KataGo GTP 进程不可用".to_string())?;
    run_final_score_with_process(process, request).map_err(|error| {
        *slot = None;
        error
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonAnalysisResponse {
    id: String,
    #[serde(default)]
    is_during_search: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    root_info: RootInfo,
    #[serde(default)]
    move_infos: Vec<MoveInfo>,
    #[serde(default)]
    ownership: Vec<f64>,
    #[serde(default)]
    ownership_stdev: Vec<f64>,
    #[serde(default)]
    human_policy: Vec<f64>,
}

fn read_analysis_response(
    process: &mut KataGoProcess,
    request_id: &str,
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Result<JsonAnalysisResponse, String> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            return Err("KataGo 分析请求已取消".to_string());
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(format!("KataGo 分析响应超时 ({timeout:?})"));
        }
        let wait = remaining.min(Duration::from_millis(100));
        match process.stdout_rx.recv_timeout(wait) {
            Ok(StdoutMsg::Line(line)) => {
                let response: JsonAnalysisResponse = serde_json::from_str(&line)
                    .map_err(|e| format!("无法解析 KataGo JSON 响应: {e}"))?;
                if response.id != request_id {
                    continue;
                }
                if let Some(error) = response.error {
                    return Err(format!("KataGo 分析失败: {error}"));
                }
                if !response.is_during_search {
                    return Ok(response);
                }
            }
            Ok(StdoutMsg::Eof) => return Err("KataGo 进程意外退出 (EOF)".to_string()),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return Err("KataGo 输出管道已断开".to_string()),
        }
    }
}

fn current_player_from_move_count(count: usize) -> &'static str {
    if count % 2 == 0 {
        "B"
    } else {
        "W"
    }
}

fn analysis_players(
    moves: &[[String; 2]],
    explicit_initial: Option<&str>,
    default_player: &str,
) -> (String, String) {
    let initial = explicit_initial
        .or_else(|| moves.first().map(|mv| mv[0].as_str()))
        .unwrap_or(default_player)
        .to_string();
    let current = moves
        .last()
        .map(|mv| if mv[0] == "B" { "W" } else { "B" }.to_string())
        .unwrap_or_else(|| initial.clone());
    (initial, current)
}

fn kata_go_komi(value: f64) -> Result<f64, String> {
    // All backend callers use points. Never hide a missing zi conversion by
    // rounding 3.75 to 4: that changes both the komi and possibly the winner.
    if !value.is_finite() || value.abs() > 1000.0 || (value * 2.0).fract() != 0.0 {
        return Err("KataGo 贴目必须是有限的整数或半整数目（中国规则请先将子转换为目）".into());
    }
    Ok(value)
}

fn split_opening_sequence(
    moves: Vec<GtpMove>,
    handicap: usize,
) -> (Vec<[String; 2]>, Vec<[String; 2]>, &'static str, usize) {
    let normalized: Vec<[String; 2]> = moves
        .into_iter()
        .map(|mv| {
            let coordinate = if mv.coordinate.eq_ignore_ascii_case("pass") {
                "pass".to_string()
            } else {
                mv.coordinate.to_uppercase()
            };
            [mv.player.to_uppercase(), coordinate]
        })
        .collect();

    let opening_count = if handicap == 0 {
        0
    } else {
        normalized
            .iter()
            .take(handicap)
            .take_while(|mv| mv[0] == "W")
            .count()
    };
    let opening_stones = normalized[..opening_count].to_vec();
    let normal_moves = normalized[opening_count..].to_vec();
    let current_player = if handicap > 0 && opening_count < handicap {
        "W"
    } else {
        current_player_from_move_count(normal_moves.len())
    };
    (opening_stones, normal_moves, current_player, opening_count)
}

fn run_analysis(
    runtime: &EngineRuntime,
    data_dir: &Path,
    slot: &mut Option<KataGoProcess>,
    request: AnalyzeRequest,
    use_human_model: bool,
    cancel: Option<&AtomicBool>,
) -> Result<KataGoAnalysis, String> {
    if request.human_profile.is_some() && runtime.human_model.is_none() {
        return Err("Human SL 模型未配置，请检查 resources/katago-human".to_string());
    }
    let process = ensure_process(slot, runtime, data_dir, use_human_model)?;
    let params = analyze_params(&request.mode, &request.strength);
    let timeout = params.timeout;
    analyze_with_process(process, request, timeout, cancel)
}

fn slot_running(slot: &mut Option<KataGoProcess>) -> bool {
    slot.as_mut()
        .map(|process| {
            process
                .child
                .try_wait()
                .map(|status| status.is_none())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn engine_status(state: State<'_, KataGoState>) -> Result<EngineStatus, String> {
    let configured = state.runtime.as_ref().is_some_and(configured);
    let warming = state.warming.load(Ordering::Acquire);
    let last_error = state
        .last_error
        .lock()
        .map_err(|_| "无法读取 KataGo 错误状态".to_string())?
        .clone();
    let mut move_slot = state
        .move_process
        .lock()
        .map_err(|_| "无法读取 KataGo 状态".to_string())?;
    let mut analysis_slot = state
        .analysis_process
        .lock()
        .map_err(|_| "无法读取 KataGo 状态".to_string())?;
    let running = slot_running(&mut move_slot) || slot_running(&mut analysis_slot);
    Ok(EngineStatus {
        configured,
        running,
        warming,
        error: last_error.clone(),
        detail: if let Some(error) = &state.configuration_error {
            error.clone()
        } else if let Some(error) = &last_error {
            error.clone()
        } else if warming {
            "KataGo 正在预热模型和推理引擎".to_string()
        } else if running {
            "KataGo 分析引擎运行中".to_string()
        } else if configured {
            format!(
                "就绪，首次分析时自动启动（配置档：{}）",
                state
                    .runtime
                    .as_ref()
                    .map(|runtime| runtime.profile_name.as_str())
                    .unwrap_or("unknown")
            )
        } else {
            "KataGo 未配置".to_string()
        },
    })
}

#[tauri::command]
pub async fn analyze_position(
    state: State<'_, KataGoState>,
    request: AnalyzeRequest,
) -> Result<KataGoAnalysis, String> {
    let runtime = state.runtime.clone().ok_or_else(|| {
        state
            .configuration_error
            .clone()
            .unwrap_or_else(|| "KataGo 未配置".to_string())
    })?;
    let data_dir = state.data_dir.clone();
    let use_human_model = request.human_profile.is_some();
    let gpu_lock = Arc::clone(&state.gpu_lock);
    let analysis_cancel = Arc::clone(&state.analysis_cancel);
    let ai_active = Arc::clone(&state.ai_active);
    if use_human_model {
        // An AI move is high priority. It invalidates any low-priority
        // recommendation search before waiting for the single GPU slot.
        analysis_cancel.store(true, Ordering::Release);
        ai_active.store(true, Ordering::Release);
    } else {
        if ai_active.load(Ordering::Acquire) {
            return Err("AI 正在思考，暂不可获取分析".to_string());
        }
        analysis_cancel.store(false, Ordering::Release);
    }
    let process = if use_human_model {
        Arc::clone(&state.move_process)
    } else {
        Arc::clone(&state.analysis_process)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let _gpu_guard = if use_human_model {
                gpu_lock
                    .lock()
                    .map_err(|_| "无法锁定 GPU 分析调度器".to_string())?
            } else {
                gpu_lock
                    .try_lock()
                    .map_err(|_| "GPU 当前正忙，请稍后再获取分析".to_string())?
            };
            let mut slot = process
                .lock()
                .map_err(|_| "无法锁定 KataGo 进程".to_string())?;
            run_analysis(
                &runtime,
                &data_dir,
                &mut slot,
                request,
                use_human_model,
                if use_human_model {
                    None
                } else {
                    Some(analysis_cancel.as_ref())
                },
            )
        })();
        if use_human_model {
            ai_active.store(false, Ordering::Release);
            analysis_cancel.store(false, Ordering::Release);
        }
        result
    })
    .await
    .map_err(|e| format!("分析任务异常: {e}"))?
}

#[tauri::command]
pub async fn final_score(
    state: State<'_, KataGoState>,
    request: FinalScoreRequest,
) -> Result<FinalScoreResult, String> {
    let runtime = state.runtime.clone().ok_or_else(|| {
        state
            .configuration_error
            .clone()
            .unwrap_or_else(|| "KataGo 未配置".to_string())
    })?;
    let data_dir = state.data_dir.clone();
    let gpu_lock = Arc::clone(&state.gpu_lock);
    let final_process = Arc::clone(&state.final_process);
    tauri::async_runtime::spawn_blocking(move || {
        let _gpu_guard = gpu_lock
            .lock()
            .map_err(|_| "无法锁定 GPU 分析调度器".to_string())?;
        let mut process = final_process
            .lock()
            .map_err(|_| "无法锁定 KataGo GTP 进程".to_string())?;
        run_final_score(&runtime, &data_dir, &mut process, request)
    })
    .await
    .map_err(|error| format!("终局计分任务异常: {error}"))?
}

#[tauri::command]
pub fn cancel_analysis(state: State<'_, KataGoState>) -> Result<(), String> {
    state.analysis_cancel.store(true, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub async fn warmup_engine(state: State<'_, KataGoState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.warmup())
        .await
        .map_err(|error| format!("引擎预热任务异常: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        discover_runtime, split_opening_sequence, GtpMove, JsonAnalysisResponse, MoveInfo, RootInfo,
    };

    #[test]
    fn parses_structured_analysis_response() {
        let response = r#"{
          "id":"42",
          "isDuringSearch":false,
          "rootInfo":{"currentPlayer":"W","visits":800,"winrate":0.62,"scoreLead":2.5,"scoreStdev":4.1,"utility":0.18},
          "moveInfos":[{"move":"D16","order":0,"visits":500,"winrate":0.62,"scoreLead":2.5,"scoreStdev":4.1,"utility":0.18,"playSelectionValue":33.2,"prior":0.2,"pv":["D16","Q4"]}],
          "ownership":[0.0],
          "ownershipStdev":[0.0]
        }"#;
        let parsed: JsonAnalysisResponse =
            serde_json::from_str(response).expect("valid KataGo JSON");

        assert_eq!(parsed.id, "42");
        assert!(!parsed.is_during_search);
        assert_eq!(parsed.root_info.current_player, "W");
        assert_eq!(parsed.move_infos.len(), 1);
        assert_eq!(parsed.move_infos[0].r#move, "D16");
        assert_eq!(parsed.move_infos[0].order, 0);
    }

    #[test]
    fn response_types_have_expected_defaults() {
        let root = RootInfo::default();
        let move_info = MoveInfo::default();
        assert_eq!(root.visits, 0);
        assert!(move_info.pv.is_empty());
    }

    #[test]
    fn analysis_params_follow_strength_budgets() {
        let beginner = super::analyze_params("fast", "beginner");
        let expert = super::analyze_params("fast", "expert");
        let deep = super::analyze_params("deep", "beginner");

        assert_eq!(beginner.target_visits, 50);
        assert_eq!(expert.target_visits, 10_000);
        assert_eq!(deep.target_visits, 5_000);
        assert!(expert.timeout > beginner.timeout);
    }

    #[test]
    fn human_profile_search_budget_is_continuous_and_9d_is_the_maximum() {
        assert_eq!(super::human_profile_visits("fast", "rank_20k"), 40);
        assert!(super::human_profile_visits("fast", "rank_10k") > 40);
        assert!(
            super::human_profile_visits("fast", "rank_1d")
                > super::human_profile_visits("fast", "rank_1k")
        );
        assert_eq!(super::human_profile_visits("fast", "rank_9d"), 1200);
        assert_eq!(super::human_profile_visits("deep", "rank_5k"), 5000);
        let ordered = (0..=28).map(|index| {
            if index < 20 {
                format!("rank_{}k", 20 - index)
            } else {
                format!("rank_{}d", index - 19)
            }
        });
        let budgets = ordered
            .map(|profile| super::human_profile_visits("fast", &profile))
            .collect::<Vec<_>>();
        assert!(budgets.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn human_sl_search_settings_scale_continuously_across_rank_boundaries() {
        let lowest = super::human_sl_settings("rank_20k");
        assert_eq!(lowest["humanSLRootExploreProbWeightless"], 0.0);
        assert_eq!(lowest["humanSLCpuctPermanent"], 0.2);

        let highest = super::human_sl_settings("rank_9d");
        assert_eq!(highest["humanSLProfile"], "rank_9d");
        assert_eq!(highest["humanSLRootExploreProbWeightless"], 0.8);
        assert_eq!(highest["humanSLCpuctPermanent"], 2.0);

        let ordered = (0..=28).map(|index| {
            if index < 20 {
                format!("rank_{}k", 20 - index)
            } else {
                format!("rank_{}d", index - 19)
            }
        });
        let settings = ordered
            .map(|profile| super::human_sl_settings(&profile))
            .collect::<Vec<_>>();
        assert!(settings.windows(2).all(|pair| {
            pair[0]["humanSLRootExploreProbWeightless"]
                .as_f64()
                .unwrap()
                <= pair[1]["humanSLRootExploreProbWeightless"]
                    .as_f64()
                    .unwrap()
                && pair[0]["humanSLCpuctPermanent"]
                    .as_f64()
                    .unwrap()
                    <= pair[1]["humanSLCpuctPermanent"]
                        .as_f64()
                        .unwrap()
        }));
        assert_eq!(settings[19]["humanSLProfile"], "rank_1k");
        assert_eq!(settings[20]["humanSLProfile"], "rank_1d");
    }

    #[test]
    fn explicit_strength_budget_overrides_human_profile_default() {
        let request: super::AnalyzeRequest = serde_json::from_value(serde_json::json!({
            "moves": [],
            "mode": "fast",
            "strength": "normal",
            "humanProfile": "rank_20k",
            "maxVisits": 4,
            "ruleSet": "chinese",
            "komi": 7.5,
            "handicap": 0
        }))
        .expect("valid analysis request");
        let params = super::analyze_params("fast", "normal");
        assert_eq!(super::target_visits(&request, &params), 4);
    }

    #[test]
    fn splits_white_handicap_moves_from_normal_history() {
        let moves = vec![
            GtpMove {
                player: "W".to_string(),
                coordinate: "D4".to_string(),
            },
            GtpMove {
                player: "W".to_string(),
                coordinate: "Q16".to_string(),
            },
            GtpMove {
                player: "B".to_string(),
                coordinate: "K10".to_string(),
            },
        ];
        let (initial, normal, current, opening_count) = split_opening_sequence(moves, 2);
        assert_eq!(opening_count, 2);
        assert_eq!(initial.len(), 2);
        assert_eq!(normal.len(), 1);
        assert_eq!(current, "W");
    }

    #[test]
    fn incomplete_white_handicap_keeps_white_to_play() {
        let moves = vec![GtpMove {
            player: "W".to_string(),
            coordinate: "D4".to_string(),
        }];
        let (initial, normal, current, opening_count) = split_opening_sequence(moves, 2);
        assert_eq!(opening_count, 1);
        assert_eq!(initial.len(), 1);
        assert!(normal.is_empty());
        assert_eq!(current, "W");
    }

    #[test]
    fn analysis_initial_player_is_not_the_side_after_replaying_moves() {
        let moves = vec![["B".to_string(), "D4".to_string()]];
        assert_eq!(super::analysis_players(&moves, None, "W"), ("B".into(), "W".into()));
        let moves = vec![moves[0].clone(), ["W".into(), "Q16".into()]];
        assert_eq!(super::analysis_players(&moves, None, "B"), ("B".into(), "B".into()));
        let setup_moves = vec![["W".into(), "pass".into()]];
        assert_eq!(super::analysis_players(&setup_moves, Some("W"), "B"), ("W".into(), "B".into()));
        assert_eq!(super::analysis_players(&[], Some("W"), "B"), ("W".into(), "W".into()));
        assert_eq!(super::analysis_players(&[], None, "W"), ("W".into(), "W".into()));
    }

    #[test]
    fn validates_point_komi_without_silent_rounding() {
        for value in [0.0, 0.5, 7.5, 6.5, -0.5] {
            assert_eq!(super::kata_go_komi(value), Ok(value));
        }
        for value in [3.75, f64::NAN, f64::INFINITY, 1000.5] {
            assert!(super::kata_go_komi(value).is_err());
        }
    }

    #[test]
    #[ignore = "requires the local KataGo executable and model"]
    fn verifies_local_chinese_japanese_korean_scoring() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources).expect("local KataGo runtime");
        let data_dir = std::env::temp_dir().join("shiguang-go-scoring-rules-test");
        let mut slot = None;
        // Fully settled 19x19 position: Black owns 181 intersections, White
        // owns 180. Black has three one-point eyes, White has two. Both have
        // played 178 stones, so Black leads by one point before komi.
        let letters = b"ABCDEFGHJKLMNOPQRST";
        let mut black = Vec::new();
        let mut white = Vec::new();
        for row in 0..19 {
            for col in 0..19 {
                if [(2, 2), (4, 2), (6, 2), (2, 16), (4, 16)].contains(&(row, col)) {
                    continue;
                }
                let coordinate = format!("{}{}", letters[col] as char, 19 - row);
                if col < 9 || (col == 9 && row % 2 == 0) {
                    black.push(coordinate);
                } else {
                    white.push(coordinate);
                }
            }
        }
        assert_eq!(black.len(), 178);
        assert_eq!(white.len(), 178);
        let mut moves = Vec::new();
        for (b, w) in black.iter().zip(white.iter()) {
            moves.push(GtpMove { player: "B".into(), coordinate: b.clone() });
            moves.push(GtpMove { player: "W".into(), coordinate: w.clone() });
        }
        // These are real passes from the fixture, not passes injected by the scorer.
        moves.push(GtpMove { player: "B".into(), coordinate: "pass".into() });
        moves.push(GtpMove { player: "W".into(), coordinate: "pass".into() });
        for (rule_set, komi, expected) in [
            ("chinese", 7.5, "W+6.5"),
            ("japanese", 6.5, "W+5.5"),
            ("korean", 6.5, "W+5.5"),
            ("chinese", 0.5, "B+0.5"),
            ("japanese", 0.0, "B+1.0"),
            ("chinese", 1.0, "0"),
            ("japanese", 1.0, "0"),
        ] {
            let result = super::run_final_score(&runtime, &data_dir, &mut slot, super::FinalScoreRequest {
                moves: moves.clone(), rule_set: rule_set.into(), komi,
            }).expect("live rule-specific score");
            println!("{rule_set} komi={komi}: {} dead={:?}", result.final_score, result.dead_stones);
            assert_eq!(result.final_score, expected, "{rule_set}, komi={komi}");
            assert!(result.dead_stones.is_empty());
        }
        // The final board is identical, but White first sacrifices A19.
        // Area scoring is unchanged; territory scoring adds the prisoner.
        let mut captured_moves = vec![
            GtpMove { player: "B".into(), coordinate: "B19".into() },
            GtpMove { player: "W".into(), coordinate: "A19".into() },
            GtpMove { player: "B".into(), coordinate: "A18".into() },
        ];
        for (index, w) in white.iter().enumerate() {
            captured_moves.push(GtpMove { player: "W".into(), coordinate: w.clone() });
            if let Some(b) = black.iter().filter(|point| !["B19", "A18"].contains(&point.as_str())).nth(index) {
                captured_moves.push(GtpMove { player: "B".into(), coordinate: b.clone() });
            }
        }
        for (rule_set, expected) in [("chinese", "B+1.0"), ("japanese", "B+2.0"), ("korean", "B+2.0")] {
            let result = super::run_final_score(&runtime, &data_dir, &mut slot, super::FinalScoreRequest {
                moves: captured_moves.clone(), rule_set: rule_set.into(), komi: 0.0,
            }).expect("live captured-prisoner score");
            println!("{rule_set} captured white stone: {}", result.final_score);
            assert_eq!(result.final_score, expected);
            assert!(result.dead_stones.is_empty());
        }
        // Enlarge one Black eye and leave a living-on-board but dead White
        // stone inside it. Area is unchanged; territory gains two empty
        // points and one prisoner compared with the original fixture.
        let mut dead_moves = moves.iter()
            .filter(|mv| !["D17", "E17", "pass"].contains(&mv.coordinate.as_str()))
            .cloned().collect::<Vec<_>>();
        dead_moves.push(GtpMove { player: "W".into(), coordinate: "C17".into() });
        for (rule_set, komi, expected) in [
            ("chinese", 7.5, "W+6.5"),
            ("japanese", 6.5, "W+2.5"),
            ("korean", 6.5, "W+2.5"),
        ] {
            let result = super::run_final_score(&runtime, &data_dir, &mut slot, super::FinalScoreRequest {
                moves: dead_moves.clone(), rule_set: rule_set.into(), komi,
            }).expect("live dead-stone score");
            println!("{rule_set} dead white stone: {} dead={:?}", result.final_score, result.dead_stones);
            assert_eq!(result.final_score, expected);
            assert_eq!(result.dead_stones, vec!["C17"]);
        }
    }

    #[test]
    #[ignore = "diagnostic: GTP final_score estimates, not exact seki adjudication"]
    fn diagnoses_local_seki_score_estimation() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources).expect("local KataGo runtime");
        let data_dir = std::env::temp_dir().join("shiguang-go-seki-diagnostic");
        let mut slot = None;
        let letters = b"ABCDEFGHJKLMNOPQRST";
        // Both groups have one private eye and two shared liberties.
        // Record exact counting separately from the neural lead estimate.
        let mut seki_moves = Vec::new();
        for row in 0..19 {
            for col in 0..19 {
                if [(2, 2), (2, 16), (1, 9), (3, 9)].contains(&(row, col)) {
                    continue;
                }
                let player = if col < 9 || (col == 9 && row % 2 == 0) { "B" } else { "W" };
                seki_moves.push(GtpMove {
                    player: player.into(),
                    coordinate: format!("{}{}", letters[col] as char, 19 - row),
                });
            }
        }
        for (rule_set, komi, expected) in [
            ("chinese", 7.5, "W+4.5"),
            ("japanese", 6.5, "W+6.5"),
            ("korean", 6.5, "W+6.5"),
        ] {
            let result = super::run_final_score(&runtime, &data_dir, &mut slot, super::FinalScoreRequest {
                moves: seki_moves.clone(), rule_set: rule_set.into(), komi,
            }).expect("live seki score");
            println!("{rule_set} seki: {} dead={:?}", result.final_score, result.dead_stones);
            println!("exact agreed-position counting: {expected}; estimate matches: {}", result.final_score == expected);
            assert!(result.final_score.starts_with("W+"));
            assert!(result.dead_stones.is_empty());
        }
    }

    #[test]
    fn profile_discovery_prefers_estimate_model_and_config() {
        let root =
            std::env::temp_dir().join(format!("shiguang-go-runtime-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let development = root.join("development");
        let bundled = root.join("bundled");
        let estimate = development.join("katago-estimate");
        let standard = development.join("katago");
        std::fs::create_dir_all(&estimate).unwrap();
        std::fs::create_dir_all(&standard).unwrap();

        std::fs::write(estimate.join("analysis_example.cfg"), b"").unwrap();
        std::fs::write(estimate.join("model.bin.gz"), b"").unwrap();
        std::fs::write(standard.join("analysis.cfg"), b"").unwrap();
        std::fs::write(standard.join("model.bin.gz"), b"").unwrap();

        let profile = super::select_profile_dir(&development, &bundled).unwrap();
        assert_eq!(profile, estimate);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "requires the local KataGo executable and model"]
    fn queries_local_research_setup_positions() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources)
            .expect("local KataGo resources are unavailable");
        let data_dir = std::env::temp_dir().join("shiguang-go-research-setup-test");
        let mut slot = None;
        for size in [9, 19] {
            let moves = if size == 9 {
                vec![]
            } else {
                vec![super::GtpMove {
                    player: "W".into(),
                    coordinate: "pass".into(),
                }]
            };
            let result = super::run_analysis(
                &runtime,
                &data_dir,
                &mut slot,
                super::AnalyzeRequest {
                    moves,
                    mode: "fast".into(),
                    strength: "beginner".into(),
                    max_visits: Some(16),
                    human_profile: None,
                    rule_set: "chinese".into(),
                    komi: 7.5,
                    handicap: 0,
                    initial_stones: Some(vec![
                        super::GtpMove {
                            player: "B".into(),
                            coordinate: "D4".into(),
                        },
                        super::GtpMove {
                            player: "W".into(),
                            coordinate: "F6".into(),
                        },
                    ]),
                    initial_player: Some("W".into()),
                    board_size: Some(size),
                    search_profile: None,
                },
                false,
                None,
            )
            .expect("KataGo should analyze a setup position");
            assert_eq!(result.ownership.len(), size * size);
            assert_eq!(result.ownership_stdev.len(), size * size);
            assert_eq!(
                result.root_info.current_player,
                if size == 9 { "W" } else { "B" }
            );
            assert!(!result.move_infos.is_empty());
        }
    }

    #[test]
    #[ignore = "requires the local KataGo executable and model"]
    fn queries_local_katago_json_engine() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources)
            .expect("local KataGo resources are unavailable");
        let data_dir = std::env::temp_dir().join("shiguang-go-katago-json-test");
        let request = super::AnalyzeRequest {
            moves: Vec::new(),
            mode: "fast".to_string(),
            strength: "beginner".to_string(),
            max_visits: None,
            human_profile: None,
            rule_set: "chinese".to_string(),
            komi: 7.5,
            handicap: 0,
            initial_stones: None,
            initial_player: None,
            board_size: None,
            search_profile: None,
        };
        let mut analysis_slot = None;
        let mut move_slot = None;
        let result = super::run_analysis(
            &runtime,
            &data_dir,
            &mut analysis_slot,
            request,
            false,
            None,
        )
        .expect("KataGo JSON analysis should succeed");
        assert_eq!(result.ownership.len(), 361);
        assert_eq!(result.ownership_stdev.len(), 361);
        assert!(result.move_infos.len() >= 3);
        assert_eq!(result.root_info.current_player, "B");

        let human_result = super::run_analysis(
            &runtime,
            &data_dir,
            &mut move_slot,
            super::AnalyzeRequest {
                moves: Vec::new(),
                mode: "fast".to_string(),
                strength: "normal".to_string(),
                max_visits: None,
                human_profile: Some("rank_5k".to_string()),
                rule_set: "chinese".to_string(),
                komi: 7.5,
                handicap: 0,
                initial_stones: None,
                initial_player: None,
                board_size: None,
                search_profile: None,
            },
            true,
            None,
        )
        .expect("Human SL analysis should succeed");
        assert_eq!(human_result.human_policy.len(), 362);
        assert!(human_result
            .move_infos
            .iter()
            .any(|move_info| move_info.human_prior.unwrap_or_default() > 0.0));

        let handicap_result = super::run_analysis(
            &runtime,
            &data_dir,
            &mut move_slot,
            super::AnalyzeRequest {
                moves: vec![super::GtpMove {
                    player: "W".to_string(),
                    coordinate: "D4".to_string(),
                }],
                mode: "fast".to_string(),
                strength: "normal".to_string(),
                max_visits: None,
                human_profile: Some("rank_5k".to_string()),
                rule_set: "chinese".to_string(),
                komi: 1.0,
                handicap: 2,
                initial_stones: None,
                initial_player: None,
                board_size: None,
                search_profile: None,
            },
            true,
            None,
        )
        .expect("KataGo should accept the white handicap opening position");
        assert_eq!(handicap_result.human_policy.len(), 362);
    }

    #[test]
    #[ignore = "diagnostic: compares local Human SL profile distributions"]
    fn diagnoses_local_human_profiles() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources)
            .expect("local KataGo resources are unavailable");
        let data_dir = std::env::temp_dir().join("shiguang-go-human-profile-diagnostic");
        let mut slot = None;
        for profile in ["rank_20k", "rank_10k", "rank_5k", "rank_9d"] {
            let result = super::run_analysis(
                &runtime,
                &data_dir,
                &mut slot,
                super::AnalyzeRequest {
                    moves: Vec::new(),
                    mode: "fast".to_string(),
                    strength: "normal".to_string(),
                    max_visits: Some(40),
                    human_profile: Some(profile.to_string()),
                    rule_set: "chinese".to_string(),
                    komi: 7.5,
                    handicap: 0,
                    initial_stones: None,
                    initial_player: None,
                    board_size: Some(19),
                    search_profile: None,
                },
                true,
                None,
            )
            .expect("Human SL diagnostic analysis should succeed");
            let mut ranked = result
                .human_policy
                .iter()
                .take(361)
                .enumerate()
                .filter(|(_, probability)| **probability > 0.0)
                .collect::<Vec<_>>();
            ranked.sort_by(|left, right| right.1.total_cmp(left.1));
            println!(
                "{profile}: positive={} top={:?} pass={:.6}",
                ranked.len(),
                &ranked[..5],
                result.human_policy[361]
            );
        }
    }

    #[test]
    #[ignore = "diagnostic: verifies local 1-visit and highest-dan Human SL requests"]
    fn diagnoses_local_human_visit_extremes() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources)
            .expect("local KataGo resources are unavailable");
        let data_dir = std::env::temp_dir().join("shiguang-go-human-extremes-diagnostic");
        let mut slot = None;
        for profile in ["rank_20k", "rank_9d"] {
            let result = super::run_analysis(
                &runtime,
                &data_dir,
                &mut slot,
                super::AnalyzeRequest {
                    moves: Vec::new(),
                    mode: "fast".to_string(),
                    strength: "normal".to_string(),
                    max_visits: None,
                    human_profile: Some(profile.to_string()),
                    rule_set: "chinese".to_string(),
                    komi: 7.5,
                    handicap: 0,
                    initial_stones: None,
                    initial_player: None,
                    board_size: Some(19),
                    search_profile: None,
                },
                true,
                None,
            )
            .expect("Human SL extreme analysis should succeed");
            assert_eq!(result.human_policy.len(), 362);
            if profile == "rank_20k" {
                assert!(result.root_info.visits >= 1);
            } else {
                assert!(result.root_info.visits >= 1);
                assert!(!result.move_infos.is_empty());
            }
            println!(
                "{profile}: visits={} moves={} policy={}",
                result.root_info.visits,
                result.move_infos.len(),
                result.human_policy.len()
            );
        }
    }

    #[test]
    #[ignore = "diagnostic: compares adjacent low-rank Human SL policies"]
    fn diagnoses_adjacent_low_rank_policies() {
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources)
            .expect("local KataGo resources are unavailable");
        let data_dir = std::env::temp_dir().join("shiguang-go-adjacent-rank-diagnostic");
        let mut slot = None;
        let mut policies = Vec::new();
        for profile in ["rank_20k", "rank_18k"] {
            let result = super::run_analysis(
                &runtime,
                &data_dir,
                &mut slot,
                super::AnalyzeRequest {
                    moves: Vec::new(),
                    mode: "fast".to_string(),
                    strength: "normal".to_string(),
                    max_visits: None,
                    human_profile: Some(profile.to_string()),
                    rule_set: "chinese".to_string(),
                    komi: 7.5,
                    handicap: 0,
                    initial_stones: None,
                    initial_player: None,
                    board_size: Some(19),
                    search_profile: None,
                },
                true,
                None,
            )
            .expect("adjacent rank diagnostic analysis should succeed");
            policies.push(result.human_policy);
        }
        let total_variation = policies[0]
            .iter()
            .take(361)
            .zip(policies[1].iter().take(361))
            .map(|(left, right)| (left - right).abs())
            .sum::<f64>()
            / 2.0;
        println!("20k vs 18k policy total variation: {total_variation:.6}");
        assert!(total_variation.is_finite());
    }

    #[test]
    #[ignore = "STDIN protocol worker for tools/evaluate-ranks.mjs"]
    fn human_rank_eval_worker() {
        if std::env::var("SHIGUANG_EVAL_WORKER").as_deref() != Ok("1") {
            return;
        }
        let resources = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let runtime = discover_runtime(&resources, &resources)
            .expect("local KataGo resources are unavailable");
        let data_dir =
            std::env::temp_dir().join(format!("shiguang-go-rank-worker-{}", std::process::id()));
        let mut slot = None;
        use std::io::BufRead;
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let line = line.expect("read evaluation request");
            if line.trim() == "score" {
                println!("score-command-not-supported");
                continue;
            }
            let request: super::AnalyzeRequest =
                serde_json::from_str(&line).expect("parse evaluation request");
            let result =
                match super::run_analysis(&runtime, &data_dir, &mut slot, request, true, None) {
                    Ok(result) => result,
                    Err(error) => {
                        println!("{}", serde_json::json!({"error": error}));
                        continue;
                    }
                };
            println!(
                "{}",
                serde_json::json!({
                    "turnNumber": result.turn_number,
                    "humanPolicy": result.human_policy,
                    "rootInfo": result.root_info,
                    "moveInfos": result.move_infos,
                })
            );
            use std::io::Write;
            std::io::stdout()
                .flush()
                .expect("flush evaluation response");
        }
    }
}
