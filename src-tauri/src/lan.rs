use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::{BufRead, BufReader, BufWriter, Write},
    net::{IpAddr, Shutdown, TcpListener, TcpStream, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

const DEFAULT_PORT: u16 = 19888;
const DISCOVERY_PORT: u16 = 19889;
const MAX_PORT_ATTEMPTS: u16 = 20;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(3);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(12);
const RECONNECT_TIMEOUT: Duration = Duration::from_secs(90);
const UNDO_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct LanState {
    inner: Arc<Mutex<LanRuntime>>,
}

impl LanState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(LanRuntime::default())),
        }
    }
}

#[derive(Default)]
struct LanRuntime {
    session: Option<LanSession>,
    stop: Option<Arc<AtomicBool>>,
}

struct LanSession {
    role: LanRole,
    session_id: String,
    reconnect_token: String,
    expired_reconnect_token: Option<String>,
    password: String,
    password_mode: String,
    port: u16,
    config: RoomConfig,
    writer: Option<Arc<Mutex<BufWriter<TcpStream>>>>,
    game: HostGame,
    client_connected: bool,
    started: bool,
    game_number: u32,
    connection_id: u64,
    last_peer_activity: SystemTime,
    disconnected_at: Option<SystemTime>,
    pending_undo: Option<(String, LanRole)>,
    pending_undo_at: Option<SystemTime>,
    seen_message_ids: HashSet<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LanRole {
    Host,
    Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomConfig {
    pub board_size: u8,
    pub rule_set: String,
    pub host_color: String,
    pub handicap: u8,
    pub komi: f64,
    pub komi_unit: String,
    pub time_control: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomConfigInput {
    pub board_size: Option<u8>,
    pub rule_set: String,
    pub host_color: String,
    pub handicap: u8,
    pub komi: f64,
    pub komi_unit: String,
    pub time_control: Value,
    #[serde(default = "default_password_mode")]
    pub password_mode: String,
    #[serde(default)]
    pub password: String,
}

fn default_password_mode() -> String {
    "generated".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    pub host: String,
    pub port: u16,
    pub password: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub reconnect_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanCommandRequest {
    #[serde(rename = "type")]
    pub command_type: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub session_id: String,
    pub role: String,
    pub password: String,
    pub password_mode: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub config: RoomConfig,
    pub client_connected: bool,
    pub started: bool,
    pub game_number: u32,
    pub reconnectable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRoom {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub config: RoomConfig,
    pub password_required: bool,
    pub status: String,
    pub reconnectable: bool,
    pub game_number: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryRequest {
    protocol_version: u16,
    message_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    protocol_version: u16,
    session_id: String,
    message_id: String,
    sequence: u64,
    #[serde(rename = "type")]
    message_type: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireResult {
    winner: Option<String>,
    loser: Option<String>,
    reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireSnapshot {
    board: Vec<Vec<Option<String>>>,
    current_player: String,
    status: String,
    result: Option<WireResult>,
    consecutive_passes: u32,
    captured_by_black: u32,
    captured_by_white: u32,
    last_move: Option<Value>,
    move_number: u32,
    moves: Vec<Value>,
    handicap_remaining: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stone {
    Black,
    White,
}

impl Stone {
    fn as_str(self) -> &'static str {
        if self == Stone::Black {
            "black"
        } else {
            "white"
        }
    }
    fn opponent(self) -> Self {
        if self == Stone::Black {
            Stone::White
        } else {
            Stone::Black
        }
    }
}

struct HostGame {
    board: Vec<Vec<Option<Stone>>>,
    current_player: Stone,
    status: String,
    result: Option<WireResult>,
    consecutive_passes: u32,
    captured_by_black: u32,
    captured_by_white: u32,
    last_move: Option<Value>,
    move_number: u32,
    moves: Vec<Value>,
    handicap_remaining: u8,
    history: Vec<WireSnapshot>,
    sequence: u64,
}

impl HostGame {
    fn new(config: &RoomConfig) -> Self {
        let size = usize::from(config.board_size);
        let snapshot = WireSnapshot {
            board: vec![vec![None; size]; size],
            current_player: if config.handicap > 0 {
                "white"
            } else {
                "black"
            }
            .into(),
            status: "playing".into(),
            result: None,
            consecutive_passes: 0,
            captured_by_black: 0,
            captured_by_white: 0,
            last_move: None,
            move_number: 0,
            moves: Vec::new(),
            handicap_remaining: config.handicap,
        };
        Self {
            board: vec![vec![None; size]; size],
            current_player: if config.handicap > 0 {
                Stone::White
            } else {
                Stone::Black
            },
            status: "playing".into(),
            result: None,
            consecutive_passes: 0,
            captured_by_black: 0,
            captured_by_white: 0,
            last_move: None,
            move_number: 0,
            moves: Vec::new(),
            handicap_remaining: config.handicap,
            history: vec![snapshot],
            sequence: 0,
        }
    }

    fn snapshot(&self) -> WireSnapshot {
        WireSnapshot {
            board: self
                .board
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|stone| stone.map(Stone::as_str).map(str::to_string))
                        .collect()
                })
                .collect(),
            current_player: self.current_player.as_str().into(),
            status: self.status.clone(),
            result: self.result.clone(),
            consecutive_passes: self.consecutive_passes,
            captured_by_black: self.captured_by_black,
            captured_by_white: self.captured_by_white,
            last_move: self.last_move.clone(),
            move_number: self.move_number,
            moves: self.moves.clone(),
            handicap_remaining: self.handicap_remaining,
        }
    }

    fn restore(&mut self, snapshot: &WireSnapshot) {
        self.board = snapshot
            .board
            .iter()
            .map(|row| {
                row.iter()
                    .map(|stone| match stone.as_deref() {
                        Some("black") => Some(Stone::Black),
                        Some("white") => Some(Stone::White),
                        _ => None,
                    })
                    .collect()
            })
            .collect();
        self.current_player = if snapshot.current_player == "white" {
            Stone::White
        } else {
            Stone::Black
        };
        self.status = snapshot.status.clone();
        self.result = snapshot.result.clone();
        self.consecutive_passes = snapshot.consecutive_passes;
        self.captured_by_black = snapshot.captured_by_black;
        self.captured_by_white = snapshot.captured_by_white;
        self.last_move = snapshot.last_move.clone();
        self.move_number = snapshot.move_number;
        self.moves = snapshot.moves.clone();
        self.handicap_remaining = snapshot.handicap_remaining;
    }

    fn neighbors(&self, row: usize, col: usize) -> Vec<(usize, usize)> {
        let size = self.board.len();
        [
            (row.wrapping_sub(1), col),
            (row + 1, col),
            (row, col.wrapping_sub(1)),
            (row, col + 1),
        ]
        .into_iter()
        .filter(|(r, c)| {
            *r < size
                && *c < size
                && !(*r == row.wrapping_sub(1) && row == 0)
                && !(*c == col.wrapping_sub(1) && col == 0)
        })
        .collect()
    }

    fn group(&self, row: usize, col: usize) -> (Vec<(usize, usize)>, HashSet<(usize, usize)>) {
        let Some(color) = self.board[row][col] else {
            return (Vec::new(), HashSet::new());
        };
        let mut stack = vec![(row, col)];
        let mut visited = HashSet::new();
        let mut liberties = HashSet::new();
        let mut stones = Vec::new();
        while let Some((r, c)) = stack.pop() {
            if !visited.insert((r, c)) {
                continue;
            }
            stones.push((r, c));
            for (nr, nc) in self.neighbors(r, c) {
                match self.board[nr][nc] {
                    None => {
                        liberties.insert((nr, nc));
                    }
                    Some(next) if next == color && !visited.contains(&(nr, nc)) => {
                        stack.push((nr, nc))
                    }
                    _ => {}
                }
            }
        }
        (stones, liberties)
    }

    fn board_key(&self) -> String {
        self.board
            .iter()
            .flat_map(|row| row.iter())
            .map(|stone| stone.map(Stone::as_str).unwrap_or("."))
            .collect()
    }

    fn snapshot_board_key(snapshot: &WireSnapshot) -> String {
        snapshot
            .board
            .iter()
            .flat_map(|row| row.iter())
            .map(|stone| stone.as_deref().unwrap_or("."))
            .collect()
    }

    fn apply_move(&mut self, row: usize, col: usize, stone: Stone) -> Result<u32, String> {
        if self.status == "finished" {
            return Err("棋局已经结束".into());
        }
        if self.current_player != stone {
            return Err("还没有轮到该玩家".into());
        }
        if row >= self.board.len() || col >= self.board.len() || self.board[row][col].is_some() {
            return Err("此处不能落子".into());
        }
        let previous_snapshot = self.history.last().cloned();
        self.board[row][col] = Some(stone);
        let mut captured = 0;
        for (nr, nc) in self.neighbors(row, col) {
            if self.board[nr][nc] != Some(stone.opponent()) {
                continue;
            }
            let (group, liberties) = self.group(nr, nc);
            if liberties.is_empty() {
                captured += group.len() as u32;
                for (gr, gc) in group {
                    self.board[gr][gc] = None;
                }
            }
        }
        let (_, liberties) = self.group(row, col);
        if liberties.is_empty() {
            if let Some(snapshot) = previous_snapshot.as_ref() {
                self.restore(snapshot);
            }
            return Err("此处不能落子".into());
        }
        let after = self.board_key();
        if self
            .history
            .iter()
            .rev()
            .nth(1)
            .is_some_and(|snapshot| Self::snapshot_board_key(snapshot) == after)
        {
            if let Some(snapshot) = previous_snapshot.as_ref() {
                self.restore(snapshot);
            }
            return Err("此手违反打劫规则".into());
        }
        self.current_player = if self.handicap_remaining > 0 {
            if self.handicap_remaining == 1 {
                Stone::Black
            } else {
                Stone::White
            }
        } else {
            stone.opponent()
        };
        self.handicap_remaining = self.handicap_remaining.saturating_sub(1);
        self.consecutive_passes = 0;
        self.last_move = Some(json!({ "row": row, "col": col, "stone": stone.as_str() }));
        self.move_number += 1;
        self.moves.push(json!({ "stone": stone.as_str(), "coordinate": format!("{}{}", "ABCDEFGHJKLMNOPQRST".chars().nth(col).unwrap_or('A'), 19 - row) }));
        if stone == Stone::Black {
            self.captured_by_black += captured;
        } else {
            self.captured_by_white += captured;
        }
        self.history.push(self.snapshot());
        self.sequence += 1;
        Ok(captured)
    }

    fn pass(&mut self, stone: Stone) -> Result<(), String> {
        if self.status == "finished" {
            return Err("棋局已经结束".into());
        }
        if self.current_player != stone {
            return Err("还没有轮到该玩家".into());
        }
        if self.handicap_remaining > 0 {
            return Err("让子阶段不能停一手".into());
        }
        self.current_player = stone.opponent();
        self.consecutive_passes += 1;
        self.last_move = None;
        self.move_number += 1;
        self.moves
            .push(json!({ "stone": stone.as_str(), "coordinate": "pass" }));
        if self.consecutive_passes >= 2 {
            self.status = "finished".into();
            self.result = Some(WireResult {
                winner: None,
                loser: None,
                reason: "two-passes".into(),
            });
        }
        self.history.push(self.snapshot());
        self.sequence += 1;
        Ok(())
    }

    fn resign(&mut self, stone: Stone) -> Result<(), String> {
        if self.status == "finished" {
            return Err("棋局已经结束".into());
        }
        self.status = "finished".into();
        self.result = Some(WireResult {
            winner: Some(stone.opponent().as_str().into()),
            loser: Some(stone.as_str().into()),
            reason: "resignation".into(),
        });
        self.sequence += 1;
        self.history.push(self.snapshot());
        Ok(())
    }

    fn undo(&mut self) -> Result<(), String> {
        if self.status == "finished" {
            return Err("棋局已经结束，不能悔棋".into());
        }
        if self.history.len() <= 1 {
            return Err("当前没有可以悔棋的落子".into());
        }
        self.history.pop();
        let previous = self
            .history
            .last()
            .cloned()
            .ok_or_else(|| "悔棋状态恢复失败".to_string())?;
        self.restore(&previous);
        self.sequence += 1;
        Ok(())
    }
}

fn now_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{prefix}-{millis:x}")
}

fn generated_password() -> String {
    let value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos()
        % 900_000
        + 100_000;
    value.to_string()
}

fn emit_envelope(
    app: &AppHandle,
    message_type: &str,
    session_id: &str,
    sequence: u64,
    payload: Value,
) {
    let envelope = Envelope {
        protocol_version: 1,
        session_id: session_id.into(),
        message_id: now_id("msg"),
        sequence,
        message_type: message_type.into(),
        payload,
    };
    let _ = app.emit("lan://event", envelope);
}

fn write_envelope(
    writer: &Arc<Mutex<BufWriter<TcpStream>>>,
    envelope: &Envelope,
) -> Result<(), String> {
    let mut output = writer.lock().map_err(|_| "网络写入锁已损坏".to_string())?;
    let line =
        serde_json::to_string(envelope).map_err(|error| format!("网络消息编码失败: {error}"))?;
    if line.len() > MAX_MESSAGE_BYTES {
        return Err("网络消息过大".into());
    }
    output
        .write_all(line.as_bytes())
        .map_err(|error| format!("网络发送失败: {error}"))?;
    output
        .write_all(b"\n")
        .map_err(|error| format!("网络发送失败: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("网络发送失败: {error}"))
}

fn make_envelope(session_id: &str, message_type: &str, sequence: u64, payload: Value) -> Envelope {
    Envelope {
        protocol_version: 1,
        session_id: session_id.into(),
        message_id: now_id("msg"),
        sequence,
        message_type: message_type.into(),
        payload,
    }
}

fn local_addresses() -> Vec<String> {
    let mut addresses = vec!["127.0.0.1".to_string()];
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(address) = socket.local_addr() {
                if let IpAddr::V4(ip) = address.ip() {
                    if !ip.is_loopback() {
                        addresses.push(ip.to_string());
                    }
                }
            }
        }
    }
    addresses.sort();
    addresses.dedup();
    addresses
}

fn room_status(session: &LanSession) -> &'static str {
    if session.started && session.game.status != "finished" {
        if session.client_connected {
            "playing"
        } else {
            "reconnecting"
        }
    } else if session.client_connected {
        "ready"
    } else {
        "waiting"
    }
}

fn choose_listener() -> Result<(TcpListener, u16), String> {
    for offset in 0..MAX_PORT_ATTEMPTS {
        let port = DEFAULT_PORT + offset;
        if let Ok(listener) = TcpListener::bind(("0.0.0.0", port)) {
            return Ok((listener, port));
        }
    }
    Err("无法找到可用的局域网端口".into())
}

fn validate_room_config(config: &RoomConfig) -> Result<(), String> {
    if config.board_size != 19 {
        return Err("当前局域网对局只支持 19 路棋盘".into());
    }
    if !matches!(
        config.rule_set.as_str(),
        "chinese" | "japanese-korean" | "aga"
    ) {
        return Err("不支持的局域网规则".into());
    }
    if !matches!(config.host_color.as_str(), "black" | "white") {
        return Err("主机执棋颜色无效".into());
    }
    if config.handicap > 9 {
        return Err("让子数量必须在 0 到 9 之间".into());
    }
    if !config.komi.is_finite() || config.komi < 0.0 {
        return Err("贴目配置无效".into());
    }
    if !config.time_control.is_object() {
        return Err("计时配置无效".into());
    }
    Ok(())
}

fn resolve_room_password(mode: &str, password: &str) -> Result<String, String> {
    match mode {
        "generated" => Ok(generated_password()),
        "none" => Ok(String::new()),
        "custom" => {
            let value = password.trim();
            if !(4..=32).contains(&value.chars().count()) {
                return Err("自定义密码长度必须为 4 到 32 个字符".into());
            }
            if value.chars().any(char::is_whitespace) {
                return Err("自定义密码不能包含空格".into());
            }
            Ok(value.to_string())
        }
        _ => Err("不支持的房间密码方式".into()),
    }
}

fn role_stone(config: &RoomConfig, role: LanRole) -> Stone {
    let host_black = config.host_color != "white";
    match (role, host_black) {
        (LanRole::Host, true) | (LanRole::Client, false) => Stone::Black,
        _ => Stone::White,
    }
}

fn current_room_info(session: &LanSession) -> RoomInfo {
    RoomInfo {
        session_id: session.session_id.clone(),
        role: if session.role == LanRole::Host {
            "host".into()
        } else {
            "client".into()
        },
        password: if session.role == LanRole::Host {
            session.password.clone()
        } else {
            String::new()
        },
        password_mode: session.password_mode.clone(),
        port: session.port,
        addresses: local_addresses(),
        config: session.config.clone(),
        client_connected: session.client_connected,
        started: session.started,
        game_number: session.game_number,
        reconnectable: session.started
            && session.game.status != "finished"
            && !session.client_connected,
    }
}

fn current_discovered_room(session: &LanSession, host: String) -> DiscoveredRoom {
    DiscoveredRoom {
        session_id: session.session_id.clone(),
        host,
        port: session.port,
        config: session.config.clone(),
        password_required: !session.password.is_empty(),
        status: room_status(session).into(),
        reconnectable: session.started
            && session.game.status != "finished"
            && !session.client_connected,
        game_number: session.game_number,
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryResponse {
    protocol_version: u16,
    message_type: String,
    room: DiscoveredRoom,
}

fn discovery_listener(state: LanState, stop: Arc<AtomicBool>) {
    let Ok(socket) = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) else {
        return;
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(250)));
    let mut buffer = [0_u8; 4096];
    while !stop.load(Ordering::Relaxed) {
        let Ok((size, peer)) = socket.recv_from(&mut buffer) else {
            continue;
        };
        let Ok(request) = serde_json::from_slice::<DiscoveryRequest>(&buffer[..size]) else {
            continue;
        };
        if request.protocol_version != 1 || request.message_type != "discover" {
            continue;
        }
        let response = state.inner.lock().ok().and_then(|runtime| {
            runtime.session.as_ref().map(|session| DiscoveryResponse {
                protocol_version: 1,
                message_type: "room".into(),
                room: current_discovered_room(session, peer.ip().to_string()),
            })
        });
        let Some(response) = response else {
            continue;
        };
        if let Ok(bytes) = serde_json::to_vec(&response) {
            let _ = socket.send_to(&bytes, peer);
        }
    }
}

fn emit_status(app: &AppHandle, session: &LanSession) {
    emit_envelope(
        app,
        "room_state",
        &session.session_id,
        session.game.sequence,
        json!(current_room_info(session)),
    );
}

fn peer_room_info(session: &LanSession) -> RoomInfo {
    let mut info = current_room_info(session);
    info.role = "client".into();
    info.password.clear();
    info.addresses.clear();
    info
}

fn broadcast(session: &LanSession, app: &AppHandle, message_type: &str, payload: Value) {
    let envelope = make_envelope(
        &session.session_id,
        message_type,
        session.game.sequence,
        payload.clone(),
    );
    if let Some(writer) = &session.writer {
        let _ = write_envelope(writer, &envelope);
    }
    let _ = app.emit("lan://event", envelope);
}

fn send_room_state(session: &LanSession, writer: &Arc<Mutex<BufWriter<TcpStream>>>) {
    let envelope = make_envelope(
        &session.session_id,
        "room_state",
        session.game.sequence,
        json!(peer_room_info(session)),
    );
    let _ = write_envelope(writer, &envelope);
}

fn process_host_command(
    state: &LanState,
    app: &AppHandle,
    player_role: LanRole,
    request: LanCommandRequest,
) -> Result<(), String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "无法锁定局域网状态".to_string())?;
    let session = runtime
        .session
        .as_mut()
        .ok_or_else(|| "当前没有局域网房间".to_string())?;
    if session.role != LanRole::Host {
        return Err("只有主机可以处理主机命令".into());
    }
    let player = role_stone(&session.config, player_role);
    match request.command_type.as_str() {
        "start_game" => {
            if player_role != LanRole::Host {
                return Err("只有主机可以开始对局".into());
            }
            if !session.client_connected {
                return Err("还没有玩家二加入".into());
            }
            if session.started {
                return Err("对局已经开始".into());
            }
            if session.game.status == "finished" {
                session.game = HostGame::new(&session.config);
                session.game_number = session.game_number.saturating_add(1);
            }
            session.pending_undo = None;
            session.pending_undo_at = None;
            session.started = true;
            broadcast(
                session,
                app,
                "game_started",
                json!({ "snapshot": session.game.snapshot(), "config": session.config }),
            );
        }
        "submit_move" => {
            if !session.started {
                return Err("对局尚未开始".into());
            }
            let row = request
                .payload
                .get("row")
                .and_then(Value::as_u64)
                .ok_or_else(|| "缺少落子行".to_string())? as usize;
            let col = request
                .payload
                .get("col")
                .and_then(Value::as_u64)
                .ok_or_else(|| "缺少落子列".to_string())? as usize;
            session.game.apply_move(row, col, player)?;
            broadcast(
                session,
                app,
                "move_applied",
                json!({ "snapshot": session.game.snapshot() }),
            );
        }
        "submit_pass" => {
            if !session.started {
                return Err("对局尚未开始".into());
            }
            session.game.pass(player)?;
            let finished = session.game.status == "finished";
            if finished {
                session.started = false;
            }
            broadcast(
                session,
                app,
                "pass_applied",
                json!({ "snapshot": session.game.snapshot() }),
            );
            if finished {
                if let Some(writer) = &session.writer {
                    send_room_state(session, writer);
                }
            }
        }
        "resign" => {
            if !session.started {
                return Err("对局尚未开始".into());
            }
            session.game.resign(player)?;
            session.started = false;
            broadcast(
                session,
                app,
                "game_ended",
                json!({ "snapshot": session.game.snapshot() }),
            );
            if let Some(writer) = &session.writer {
                send_room_state(session, writer);
            }
        }
        "undo" => {
            return Err("悔棋需要双方确认".into());
        }
        "request_undo" => {
            if !session.started {
                return Err("对局尚未开始".into());
            }
            if session.pending_undo.is_some() {
                return Err("已有悔棋请求正在等待确认".into());
            }
            if session.game.history.len() <= 1 {
                return Err("当前没有可以悔棋的落子".into());
            }
            let request_id = now_id("undo");
            session.pending_undo = Some((request_id.clone(), player_role));
            session.pending_undo_at = Some(SystemTime::now());
            broadcast(
                session,
                app,
                "undo_requested",
                json!({
                    "requestId": request_id,
                    "requester": player.as_str()
                }),
            );
        }
        "respond_undo" => {
            if !session.started {
                return Err("对局尚未开始".into());
            }
            let request_id = request
                .payload
                .get("requestId")
                .and_then(Value::as_str)
                .ok_or_else(|| "缺少悔棋请求编号".to_string())?;
            let approved = request
                .payload
                .get("approved")
                .and_then(Value::as_bool)
                .ok_or_else(|| "缺少悔棋确认结果".to_string())?;
            let Some((pending_id, requester)) = session.pending_undo.clone() else {
                return Err("当前没有等待确认的悔棋请求".into());
            };
            if pending_id != request_id {
                return Err("悔棋请求已经失效".into());
            }
            if requester == player_role {
                return Err("不能确认自己发起的悔棋请求".into());
            }
            session.pending_undo = None;
            session.pending_undo_at = None;
            if approved {
                session.game.undo()?;
                broadcast(
                    session,
                    app,
                    "undo_applied",
                    json!({ "snapshot": session.game.snapshot() }),
                );
            } else {
                broadcast(
                    session,
                    app,
                    "undo_rejected",
                    json!({ "message": "对方拒绝了悔棋请求" }),
                );
            }
        }
        _ => return Err("当前版本暂不支持该局域网命令".into()),
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum HostWireAction {
    Reject,
    ReplyHeartbeat,
    IgnoreHeartbeatAck,
    Command,
}

fn accept_host_message(
    session: &mut LanSession,
    connection_id: u64,
    envelope: &Envelope,
) -> HostWireAction {
    if session.role != LanRole::Host
        || session.session_id != envelope.session_id
        || session.connection_id != connection_id
    {
        return HostWireAction::Reject;
    }
    session.last_peer_activity = SystemTime::now();
    match envelope.message_type.as_str() {
        "heartbeat" => HostWireAction::ReplyHeartbeat,
        "heartbeat_ack" => HostWireAction::IgnoreHeartbeatAck,
        _ if !session.seen_message_ids.insert(envelope.message_id.clone()) => HostWireAction::Reject,
        _ => HostWireAction::Command,
    }
}

fn handle_wire_message(
    state: &LanState,
    app: &AppHandle,
    role: LanRole,
    connection_id: u64,
    envelope: Envelope,
) {
    if envelope.protocol_version != 1 {
        emit_envelope(
            app,
            "error",
            &envelope.session_id,
            envelope.sequence,
            json!({ "code": "PROTOCOL_MISMATCH", "message": "协议版本不兼容" }),
        );
        return;
    }
    let (action, heartbeat_writer) = state
        .inner
        .lock()
        .ok()
        .and_then(|mut runtime| {
            let session = runtime.session.as_mut()?;
            let action = accept_host_message(session, connection_id, &envelope);
            let writer = if action == HostWireAction::ReplyHeartbeat {
                session.writer.clone()
            } else {
                None
            };
            Some((action, writer))
        })
        .unwrap_or((HostWireAction::Reject, None));
    if action == HostWireAction::ReplyHeartbeat {
        if let Some(writer) = heartbeat_writer {
            let _ = write_envelope(
                &writer,
                &make_envelope(
                    &envelope.session_id,
                    "heartbeat_ack",
                    envelope.sequence,
                    json!({}),
                ),
            );
        }
        return;
    }
    // Heartbeat acknowledgements are transport-level messages, not game commands.
    if action == HostWireAction::IgnoreHeartbeatAck {
        return;
    }
    if action == HostWireAction::Reject {
        emit_envelope(
            app,
            "error",
            &envelope.session_id,
            envelope.sequence,
            json!({ "code": "INVALID_SESSION", "message": "无效或重复的网络消息" }),
        );
        return;
    }
    if envelope.message_type == "closed" {
        finish_host_connection(state, app, "peer-left", connection_id);
        return;
    }
    let request = LanCommandRequest {
        command_type: envelope.message_type,
        payload: envelope.payload,
    };
    if let Err(error) = process_host_command(state, app, role, request) {
        let (session_id, writer) = state
            .inner
            .lock()
            .ok()
            .and_then(|runtime| {
                runtime
                    .session
                    .as_ref()
                    .map(|session| (session.session_id.clone(), session.writer.clone()))
            })
            .unwrap_or_default();
        let payload = json!({ "code": "COMMAND_REJECTED", "message": error });
        if let Some(writer) = writer {
            let _ = write_envelope(
                &writer,
                &make_envelope(&session_id, "error", envelope.sequence, payload.clone()),
            );
        }
        emit_envelope(app, "error", &session_id, envelope.sequence, payload);
    }
}

fn host_reader(
    state: LanState,
    app: AppHandle,
    stream: TcpStream,
    writer: Arc<Mutex<BufWriter<TcpStream>>>,
    connection_id: u64,
) {
    let mut reader = BufReader::new(stream);
    let Ok(Some(first_line)) = read_line_limited(&mut reader) else {
        return;
    };
    let Ok(first) = serde_json::from_str::<Envelope>(&first_line) else {
        return;
    };
    if first.message_type != "hello" {
        let _ = write_envelope(
            &writer,
            &make_envelope(
                "",
                "error",
                0,
                json!({
                    "code": "MALFORMED_MESSAGE",
                    "message": "连接握手失败"
                }),
            ),
        );
        return;
    }
    let password = first
        .payload
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let requested_room_id = first
        .payload
        .get("roomId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reconnect_token = first
        .payload
        .get("reconnectToken")
        .and_then(Value::as_str)
        .unwrap_or_default();

    let validation = state
        .inner
        .lock()
        .map_err(|_| "无法锁定局域网状态".to_string())
        .and_then(|runtime| {
            let session = runtime
                .session
                .as_ref()
                .ok_or_else(|| "房间已经关闭".to_string())?;
            if session.role != LanRole::Host || session.connection_id != connection_id {
                return Err("连接已经失效".into());
            }
            if !requested_room_id.is_empty() && requested_room_id != session.session_id {
                return Err("房间已经变化，请重新扫描房间".into());
            }
            if session.password != password {
                return Err("房间密码错误".into());
            }
            if session.client_connected {
                return Err("房间已有玩家连接".into());
            }
            if session.started
                && session.game.status != "finished"
                && reconnect_token != session.reconnect_token
            {
                return Err("对局进行中，只允许原玩家重新加入".into());
            }
            Ok(())
        });
    if let Err(error) = validation {
        let _ = write_envelope(
            &writer,
            &make_envelope(
                "",
                "error",
                0,
                json!({
                    "code": "JOIN_REJECTED",
                    "message": error
                }),
            ),
        );
        return;
    }

    if let Ok(mut runtime) = state.inner.lock() {
        if let Some(session) = runtime.session.as_mut() {
            session.client_connected = true;
            session.disconnected_at = None;
            session.last_peer_activity = SystemTime::now();
            session.expired_reconnect_token = None;
            let welcome = make_envelope(
                &session.session_id,
                "welcome",
                session.game.sequence,
                json!({
                    "reconnectToken": session.reconnect_token,
                    "config": session.config,
                    "role": "client",
                    "gameNumber": session.game_number,
                    "resuming": session.started && session.game.status != "finished"
                }),
            );
            let _ = write_envelope(&writer, &welcome);
            send_room_state(session, &writer);
            if session.started && session.game.status != "finished" {
                let game_started = make_envelope(
                    &session.session_id,
                    "game_started",
                    session.game.sequence,
                    json!({ "snapshot": session.game.snapshot(), "config": session.config }),
                );
                let _ = write_envelope(&writer, &game_started);
            }
            emit_status(&app, session);
        }
    }
    loop {
        match read_line_limited(&mut reader) {
            Ok(Some(line)) => {
                let Ok(envelope) = serde_json::from_str::<Envelope>(&line) else {
                    continue;
                };
                handle_wire_message(&state, &app, LanRole::Client, connection_id, envelope);
            }
            Ok(None) => {
                finish_host_connection(&state, &app, "eof", connection_id);
                return;
            }
            Err(error) => {
                finish_host_connection(
                    &state,
                    &app,
                    &format!("read-error: {error}"),
                    connection_id,
                );
                return;
            }
        }
    }
}

fn finish_host_connection(state: &LanState, app: &AppHandle, reason: &str, connection_id: u64) {
    let mut session_id = String::new();
    if let Ok(mut runtime) = state.inner.lock() {
        if let Some(session) = runtime.session.as_mut() {
            if session.connection_id != connection_id || !session.client_connected {
                return;
            }
            session_id = session.session_id.clone();
            session.client_connected = false;
            session.writer = None;
            session.disconnected_at = Some(SystemTime::now());
            session.pending_undo = None;
            session.pending_undo_at = None;
            emit_status(app, session);
        }
    }
    emit_envelope(
        app,
        "disconnected",
        &session_id,
        0,
        json!({ "reason": reason }),
    );
}

fn read_line_limited(reader: &mut BufReader<TcpStream>) -> Result<Option<String>, String> {
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(bytes) => {
                if bytes == 0 {
                    return Ok(None);
                }
                if line.len() > MAX_MESSAGE_BYTES {
                    return Err("网络消息过大".into());
                }
                return Ok(Some(line.trim_end_matches(['\r', '\n']).to_string()));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                // A non-blocking socket may have no complete message yet.
                // Treat this as temporary lack of data, not a disconnect.
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn host_listener(state: LanState, app: AppHandle, listener: TcpListener, stop: Arc<AtomicBool>) {
    let _ = listener.set_nonblocking(true);
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                // The listener is non-blocking so it can poll for new peers,
                // but each accepted connection must block while waiting for
                // the next protocol message.
                if stream.set_nonblocking(false).is_err() {
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                let connection_id = state.inner.lock().ok().and_then(|mut runtime| {
                    let session = runtime.session.as_mut()?;
                    if session.client_connected {
                        return None;
                    }
                    session.connection_id = session.connection_id.saturating_add(1);
                    Some(session.connection_id)
                });
                let Some(connection_id) = connection_id else {
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                };
                let writer = match stream.try_clone() {
                    Ok(clone) => Arc::new(Mutex::new(BufWriter::new(clone))),
                    Err(_) => continue,
                };
                if let Ok(mut runtime) = state.inner.lock() {
                    if let Some(session) = runtime.session.as_mut() {
                        session.writer = Some(writer.clone());
                    }
                }
                let reader_state = state.clone();
                let reader_app = app.clone();
                let monitor_state = state.clone();
                let monitor_app = app.clone();
                let monitor_writer = writer.clone();
                let monitor_stop = stop.clone();
                thread::spawn(move || {
                    host_connection_monitor(
                        monitor_state,
                        monitor_app,
                        monitor_writer,
                        connection_id,
                        monitor_stop,
                    )
                });
                thread::spawn(move || {
                    host_reader(reader_state, reader_app, stream, writer, connection_id)
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(80))
            }
            Err(_) => break,
        }
    }
}

fn host_connection_monitor(
    state: LanState,
    app: AppHandle,
    writer: Arc<Mutex<BufWriter<TcpStream>>>,
    connection_id: u64,
    stop: Arc<AtomicBool>,
) {
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(HEARTBEAT_INTERVAL);
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let (session_id, sequence, timed_out) = state
            .inner
            .lock()
            .ok()
            .and_then(|runtime| {
                let session = runtime.session.as_ref()?;
                if session.connection_id != connection_id || !session.client_connected {
                    return None;
                }
                let elapsed = SystemTime::now()
                    .duration_since(session.last_peer_activity)
                    .unwrap_or_default();
                Some((
                    session.session_id.clone(),
                    session.game.sequence,
                    elapsed >= HEARTBEAT_TIMEOUT,
                ))
            })
            .unwrap_or_else(|| (String::new(), 0, true));
        if timed_out {
            let _ = writer
                .lock()
                .ok()
                .and_then(|locked| locked.get_ref().shutdown(Shutdown::Both).ok());
            finish_host_connection(&state, &app, "heartbeat-timeout", connection_id);
            return;
        }
        let heartbeat = make_envelope(&session_id, "heartbeat", sequence, json!({}));
        if write_envelope(&writer, &heartbeat).is_err() {
            finish_host_connection(&state, &app, "heartbeat-write-error", connection_id);
            return;
        }
    }
}

fn room_maintenance(state: LanState, app: AppHandle, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_secs(1));
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let undo_expired = state.inner.lock().ok().and_then(|mut runtime| {
            let session = runtime.session.as_mut()?;
            let requested_at = session.pending_undo_at?;
            if SystemTime::now()
                .duration_since(requested_at)
                .unwrap_or_default()
                < UNDO_RESPONSE_TIMEOUT
            {
                return None;
            }
            session.pending_undo = None;
            session.pending_undo_at = None;
            Some((session.session_id.clone(), session.game.sequence))
        });
        if let Some((session_id, sequence)) = undo_expired {
            emit_envelope(
                &app,
                "undo_rejected",
                &session_id,
                sequence,
                json!({ "message": "悔棋请求超时，已自动拒绝" }),
            );
        }
        let timed_out = state.inner.lock().ok().and_then(|mut runtime| {
            let session = runtime.session.as_mut()?;
            if session.role != LanRole::Host
                || !session.started
                || session.game.status == "finished"
                || session.client_connected
            {
                return None;
            }
            let disconnected_at = session.disconnected_at?;
            if SystemTime::now()
                .duration_since(disconnected_at)
                .unwrap_or_default()
                < RECONNECT_TIMEOUT
            {
                return None;
            }
            let lost_token = session.reconnect_token.clone();
            let _ = session
                .game
                .resign(role_stone(&session.config, LanRole::Client));
            session.expired_reconnect_token = Some(lost_token);
            session.started = false;
            session.disconnected_at = None;
            Some((
                session.session_id.clone(),
                session.game.sequence,
                session.game.snapshot(),
            ))
        });
        if let Some((session_id, sequence, snapshot)) = timed_out {
            emit_envelope(
                &app,
                "game_ended",
                &session_id,
                sequence,
                json!({ "snapshot": snapshot, "reason": "disconnect-timeout" }),
            );
            if let Ok(runtime) = state.inner.lock() {
                if let Some(session) = runtime.session.as_ref() {
                    emit_status(&app, session);
                }
            }
        }
    }
}

fn client_reader(state: LanState, app: AppHandle, stream: TcpStream) {
    let mut reader = BufReader::new(stream);
    loop {
        let line = match read_line_limited(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => {
                finish_client_connection(&state, &app, "eof");
                return;
            }
            Err(error) => {
                finish_client_connection(&state, &app, &format!("read-error: {error}"));
                return;
            }
        };
        let Ok(envelope) = serde_json::from_str::<Envelope>(&line) else {
            continue;
        };
        if envelope.message_type == "heartbeat" {
            let writer = state.inner.lock().ok().and_then(|runtime| {
                runtime
                    .session
                    .as_ref()
                    .and_then(|session| session.writer.clone())
            });
            if let Some(writer) = writer {
                let _ = write_envelope(
                    &writer,
                    &make_envelope(
                        &envelope.session_id,
                        "heartbeat_ack",
                        envelope.sequence,
                        json!({}),
                    ),
                );
            }
            continue;
        }
        if envelope.message_type == "welcome" {
            if let Ok(mut runtime) = state.inner.lock() {
                if let Some(session) = runtime.session.as_mut() {
                    session.session_id = envelope.session_id.clone();
                    if let Some(token) = envelope
                        .payload
                        .get("reconnectToken")
                        .and_then(Value::as_str)
                    {
                        session.reconnect_token = token.into();
                    }
                    if let Some(config) = envelope
                        .payload
                        .get("config")
                        .and_then(|value| serde_json::from_value::<RoomConfig>(value.clone()).ok())
                    {
                        session.config = config;
                    }
                    session.last_peer_activity = SystemTime::now();
                }
            }
        } else if let Ok(mut runtime) = state.inner.lock() {
            if let Some(session) = runtime.session.as_mut() {
                session.last_peer_activity = SystemTime::now();
            }
        }
        let _ = app.emit("lan://event", envelope);
    }
}

fn client_connection_monitor(
    state: LanState,
    writer: Arc<Mutex<BufWriter<TcpStream>>>,
    stop: Arc<AtomicBool>,
) {
    while !stop.load(Ordering::Relaxed) {
        thread::sleep(HEARTBEAT_INTERVAL);
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let session = state.inner.lock().ok().and_then(|runtime| {
            runtime
                .session
                .as_ref()
                .map(|session| (session.session_id.clone(), session.game.sequence))
        });
        let Some((session_id, sequence)) = session else {
            return;
        };
        let heartbeat = make_envelope(&session_id, "heartbeat", sequence, json!({}));
        if write_envelope(&writer, &heartbeat).is_err() {
            return;
        }
    }
}

fn finish_client_connection(state: &LanState, app: &AppHandle, reason: &str) {
    let mut session_id = String::new();
    if let Ok(mut runtime) = state.inner.lock() {
        if let Some(session) = runtime.session.as_mut() {
            session_id = session.session_id.clone();
            session.client_connected = false;
            session.writer = None;
            session.disconnected_at = Some(SystemTime::now());
        }
    }
    emit_envelope(
        &app,
        "disconnected",
        &session_id,
        0,
        json!({ "reason": reason }),
    );
}

#[tauri::command]
pub fn lan_get_local_addresses() -> Vec<String> {
    local_addresses()
}

#[tauri::command]
pub fn lan_scan_rooms() -> Result<Vec<DiscoveredRoom>, String> {
    let socket =
        UdpSocket::bind(("0.0.0.0", 0)).map_err(|error| format!("无法扫描局域网房间: {error}"))?;
    socket
        .set_broadcast(true)
        .map_err(|error| format!("无法启用局域网广播: {error}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(650)))
        .map_err(|error| format!("无法设置局域网扫描超时: {error}"))?;
    let request = serde_json::to_vec(&DiscoveryRequest {
        protocol_version: 1,
        message_type: "discover".into(),
    })
    .map_err(|error| format!("局域网扫描请求编码失败: {error}"))?;
    let destinations = [
        format!("255.255.255.255:{DISCOVERY_PORT}"),
        format!("127.0.0.1:{DISCOVERY_PORT}"),
    ];
    for destination in destinations {
        let _ = socket.send_to(&request, destination);
    }

    let mut rooms = Vec::new();
    let mut seen = HashSet::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match socket.recv_from(&mut buffer) {
            Ok((size, _)) => {
                let Ok(response) = serde_json::from_slice::<DiscoveryResponse>(&buffer[..size])
                else {
                    continue;
                };
                if response.protocol_version != 1
                    || response.message_type != "room"
                    || !seen.insert(response.room.session_id.clone())
                {
                    continue;
                }
                rooms.push(response.room);
            }
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {
                // Windows reports ICMP port-unreachable replies for UDP probes as WSAECONNRESET.
                // A host without the discovery listener is not a scan failure; keep listening.
                continue;
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                break
            }
            Err(error) => return Err(format!("局域网扫描失败: {error}")),
        }
    }
    rooms.sort_by(|left, right| left.host.cmp(&right.host).then(left.port.cmp(&right.port)));
    Ok(rooms)
}

#[tauri::command]
pub fn lan_create_room(
    state: State<'_, LanState>,
    app: AppHandle,
    config: RoomConfigInput,
) -> Result<RoomInfo, String> {
    let room_config = RoomConfig {
        board_size: config.board_size.unwrap_or(19),
        rule_set: config.rule_set,
        host_color: config.host_color,
        handicap: config.handicap,
        komi: config.komi,
        komi_unit: config.komi_unit,
        time_control: config.time_control,
    };
    validate_room_config(&room_config)?;
    let password = resolve_room_password(&config.password_mode, &config.password)?;
    let (listener, port) = choose_listener()?;
    let session_id = now_id("room");
    let reconnect_token = now_id("resume");
    let session = LanSession {
        role: LanRole::Host,
        session_id: session_id.clone(),
        reconnect_token,
        expired_reconnect_token: None,
        password,
        password_mode: config.password_mode,
        port,
        config: room_config,
        writer: None,
        game: HostGame::new(&RoomConfig {
            board_size: 19,
            rule_set: "chinese".into(),
            host_color: "black".into(),
            handicap: 0,
            komi: 7.5,
            komi_unit: "子".into(),
            time_control: json!({}),
        }),
        client_connected: false,
        started: false,
        game_number: 1,
        connection_id: 0,
        last_peer_activity: SystemTime::now(),
        disconnected_at: None,
        pending_undo: None,
        pending_undo_at: None,
        seen_message_ids: HashSet::new(),
    };
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "无法锁定局域网状态".to_string())?;
    if runtime.session.is_some() {
        return Err("已经存在局域网房间".into());
    }
    let game_config = session.config.clone();
    let mut session = session;
    session.game = HostGame::new(&game_config);
    runtime.session = Some(session);
    let stop = Arc::new(AtomicBool::new(false));
    runtime.stop = Some(stop.clone());
    let thread_state = state.inner.clone();
    let listener_app = app.clone();
    let listener_stop = stop.clone();
    thread::spawn(move || {
        host_listener(
            LanState {
                inner: thread_state,
            },
            listener_app,
            listener,
            listener_stop,
        )
    });
    let discovery_state = LanState {
        inner: state.inner.clone(),
    };
    let discovery_stop = stop.clone();
    thread::spawn(move || discovery_listener(discovery_state, discovery_stop));
    let maintenance_state = LanState {
        inner: state.inner.clone(),
    };
    let maintenance_app = app.clone();
    let maintenance_stop = stop.clone();
    thread::spawn(move || room_maintenance(maintenance_state, maintenance_app, maintenance_stop));
    let info = runtime
        .session
        .as_ref()
        .map(current_room_info)
        .ok_or_else(|| "创建房间失败".to_string())?;
    Ok(info)
}

#[tauri::command]
pub fn lan_join_room(
    state: State<'_, LanState>,
    app: AppHandle,
    request: JoinRequest,
) -> Result<(), String> {
    let stream = TcpStream::connect((request.host.as_str(), request.port))
        .map_err(|error| format!("连接房间失败: {error}"))?;
    let writer_stream = stream
        .try_clone()
        .map_err(|error| format!("无法建立网络写入通道: {error}"))?;
    let writer = Arc::new(Mutex::new(BufWriter::new(writer_stream)));
    let config = RoomConfig {
        board_size: 19,
        rule_set: "chinese".into(),
        host_color: "black".into(),
        handicap: 0,
        komi: 7.5,
        komi_unit: "子".into(),
        time_control: json!({}),
    };
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "无法锁定局域网状态".to_string())?;
    if runtime.session.is_some() {
        return Err("已经加入或创建了局域网房间".into());
    }
    let session_id = request
        .session_id
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| now_id("pending"));
    let session = LanSession {
        role: LanRole::Client,
        session_id: session_id.clone(),
        reconnect_token: request.reconnect_token.clone().unwrap_or_default(),
        expired_reconnect_token: None,
        password: request.password.clone(),
        password_mode: "generated".into(),
        port: request.port,
        config,
        writer: Some(writer.clone()),
        game: HostGame::new(&RoomConfig {
            board_size: 19,
            rule_set: "chinese".into(),
            host_color: "black".into(),
            handicap: 0,
            komi: 7.5,
            komi_unit: "子".into(),
            time_control: json!({}),
        }),
        client_connected: true,
        started: false,
        game_number: 0,
        connection_id: 0,
        last_peer_activity: SystemTime::now(),
        disconnected_at: None,
        pending_undo: None,
        pending_undo_at: None,
        seen_message_ids: HashSet::new(),
    };
    runtime.session = Some(session);
    let stop = Arc::new(AtomicBool::new(false));
    runtime.stop = Some(stop.clone());
    let hello = make_envelope(
        &session_id,
        "hello",
        0,
        json!({
            "password": request.password,
            "roomId": request.session_id,
            "reconnectToken": request.reconnect_token
        }),
    );
    write_envelope(&writer, &hello)?;
    let thread_state = LanState {
        inner: state.inner.clone(),
    };
    let monitor_state = LanState {
        inner: state.inner.clone(),
    };
    let monitor_writer = writer.clone();
    let monitor_stop = stop.clone();
    thread::spawn(move || client_connection_monitor(monitor_state, monitor_writer, monitor_stop));
    thread::spawn(move || client_reader(thread_state, app, stream));
    Ok(())
}

#[tauri::command]
pub fn lan_send_command(
    state: State<'_, LanState>,
    app: AppHandle,
    request: LanCommandRequest,
) -> Result<(), String> {
    let role = state
        .inner
        .lock()
        .map_err(|_| "无法锁定局域网状态".to_string())?
        .session
        .as_ref()
        .map(|session| session.role)
        .ok_or_else(|| "当前没有局域网房间".to_string())?;
    if role == LanRole::Host {
        process_host_command(&state, &app, LanRole::Host, request)
    } else {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "无法锁定局域网状态".to_string())?;
        let session = runtime
            .session
            .as_ref()
            .ok_or_else(|| "当前没有局域网房间".to_string())?;
        let writer = session
            .writer
            .as_ref()
            .ok_or_else(|| "局域网连接尚未建立".to_string())?;
        let envelope = make_envelope(
            &session.session_id,
            &request.command_type,
            0,
            request.payload,
        );
        write_envelope(writer, &envelope)
    }
}

#[tauri::command]
pub fn lan_leave_room(state: State<'_, LanState>, app: AppHandle) -> Result<(), String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "无法关闭局域网房间".to_string())?;
    if let Some(stop) = runtime.stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(session) = runtime.session.take() {
        if let Some(writer) = session.writer {
            if let Ok(mut writer) = writer.lock() {
                let closed = make_envelope(
                    &session.session_id,
                    "closed",
                    session.game.sequence,
                    json!({}),
                );
                if let Ok(line) = serde_json::to_string(&closed) {
                    let _ = writer.write_all(line.as_bytes());
                    let _ = writer.write_all(b"\n");
                    let _ = writer.flush();
                }
                if let Ok(stream) = writer.get_ref().try_clone() {
                    let _ = stream.shutdown(Shutdown::Both);
                }
            }
        }
        emit_envelope(
            &app,
            "closed",
            &session.session_id,
            session.game.sequence,
            json!({}),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> RoomConfig {
        RoomConfig {
            board_size: 19,
            rule_set: "chinese".into(),
            host_color: "black".into(),
            handicap: 0,
            komi: 3.75,
            komi_unit: "子".into(),
            time_control: json!({ "preset": "untimed" }),
        }
    }

    fn host_session() -> LanSession {
        let config = config();
        LanSession {
            role: LanRole::Host,
            session_id: "test-session".into(),
            reconnect_token: String::new(),
            expired_reconnect_token: None,
            password: String::new(),
            password_mode: "none".into(),
            port: DEFAULT_PORT,
            game: HostGame::new(&config),
            config,
            writer: None,
            client_connected: true,
            started: true,
            game_number: 1,
            connection_id: 1,
            last_peer_activity: UNIX_EPOCH,
            disconnected_at: None,
            pending_undo: None,
            pending_undo_at: None,
            seen_message_ids: HashSet::new(),
        }
    }

    #[test]
    fn heartbeat_messages_never_become_game_commands() {
        let mut session = host_session();
        for (message_type, expected) in [
            ("heartbeat", HostWireAction::ReplyHeartbeat),
            ("heartbeat_ack", HostWireAction::IgnoreHeartbeatAck),
        ] {
            let message = make_envelope(&session.session_id, message_type, 0, json!({}));
            for _ in 0..3 {
                assert_eq!(accept_host_message(&mut session, 1, &message), expected);
            }
        }
        assert!(session.last_peer_activity > UNIX_EPOCH);
        assert!(session.seen_message_ids.is_empty());
        assert_eq!(session.game.move_number, 0);
    }

    #[test]
    fn host_messages_validate_session_and_deduplicate_commands() {
        let mut session = host_session();
        let wrong_session = make_envelope("old-session", "heartbeat_ack", 0, json!({}));
        assert_eq!(accept_host_message(&mut session, 1, &wrong_session), HostWireAction::Reject);
        let ack = make_envelope(&session.session_id, "heartbeat_ack", 0, json!({}));
        assert_eq!(accept_host_message(&mut session, 2, &ack), HostWireAction::Reject);
        assert_eq!(session.last_peer_activity, UNIX_EPOCH);

        let command = make_envelope(&session.session_id, "submit_move", 0, json!({ "row": 3, "col": 3 }));
        assert_eq!(accept_host_message(&mut session, 1, &command), HostWireAction::Command);
        assert_eq!(accept_host_message(&mut session, 1, &command), HostWireAction::Reject);
        assert_eq!(session.seen_message_ids.len(), 1);
    }

    #[test]
    fn assigns_colors_from_host_choice() {
        let mut room = config();
        assert_eq!(role_stone(&room, LanRole::Host), Stone::Black);
        assert_eq!(role_stone(&room, LanRole::Client), Stone::White);

        room.host_color = "white".into();
        assert_eq!(role_stone(&room, LanRole::Host), Stone::White);
        assert_eq!(role_stone(&room, LanRole::Client), Stone::Black);
    }

    #[test]
    fn host_game_applies_moves_and_passes() {
        let mut game = HostGame::new(&config());
        assert_eq!(game.current_player, Stone::Black);
        assert_eq!(game.apply_move(3, 3, Stone::Black), Ok(0));
        assert_eq!(game.current_player, Stone::White);
        assert_eq!(game.move_number, 1);
        assert!(game.pass(Stone::White).is_ok());
        assert_eq!(game.consecutive_passes, 1);
        assert!(game.pass(Stone::Black).is_ok());
        assert_eq!(game.status, "finished");
        assert_eq!(
            game.result.as_ref().map(|result| result.reason.as_str()),
            Some("two-passes")
        );
    }

    #[test]
    fn host_game_rejects_wrong_turn_and_suicide() {
        let mut game = HostGame::new(&config());
        assert_eq!(
            game.apply_move(3, 3, Stone::White),
            Err("还没有轮到该玩家".into())
        );

        game.board[2][3] = Some(Stone::Black);
        game.board[3][2] = Some(Stone::Black);
        game.board[3][4] = Some(Stone::Black);
        game.board[4][3] = Some(Stone::Black);
        game.current_player = Stone::White;
        assert_eq!(
            game.apply_move(3, 3, Stone::White),
            Err("此处不能落子".into())
        );
    }

    #[test]
    fn host_game_undo_restores_previous_position() {
        let mut game = HostGame::new(&config());
        game.apply_move(3, 3, Stone::Black).unwrap();
        game.apply_move(15, 15, Stone::White).unwrap();

        game.undo().unwrap();

        assert_eq!(game.move_number, 1);
        assert_eq!(game.current_player, Stone::White);
        assert_eq!(game.board[3][3], Some(Stone::Black));
        assert_eq!(game.board[15][15], None);
        assert_eq!(
            game.last_move
                .as_ref()
                .and_then(|value| value.get("row"))
                .and_then(Value::as_u64),
            Some(3)
        );
    }

    #[test]
    fn generated_password_is_six_digits() {
        let password = generated_password();
        assert_eq!(password.len(), 6);
        assert!(password.chars().all(|character| character.is_ascii_digit()));
    }

    #[test]
    fn room_password_modes_are_validated() {
        assert_eq!(resolve_room_password("none", ""), Ok(String::new()));
        assert_eq!(
            resolve_room_password("custom", "go2026"),
            Ok("go2026".into())
        );
        assert!(resolve_room_password("custom", "abc").is_err());
        assert!(resolve_room_password("custom", "go 2026").is_err());
        assert!(resolve_room_password("unknown", "").is_err());
    }

    #[test]
    fn validates_room_configuration_before_listening() {
        let mut room = config();
        assert!(validate_room_config(&room).is_ok());
        room.board_size = 13;
        assert!(validate_room_config(&room).is_err());
        room.board_size = 19;
        room.host_color = "random".into();
        assert!(validate_room_config(&room).is_err());
    }
}
