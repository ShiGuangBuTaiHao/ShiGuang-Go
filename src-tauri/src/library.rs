use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::Manager;

fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("library");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("records.sqlite3"))
}

fn connect(path: PathBuf) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection.busy_timeout(std::time::Duration::from_secs(5)).map_err(|error| error.to_string())?;
    connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS library_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, collections TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, sgf TEXT NOT NULL, original_sgf TEXT NOT NULL);
        INSERT OR IGNORE INTO library_state VALUES(1, 0, '[]');").map_err(|error| error.to_string())?;
    Ok(connection)
}

fn load_database(path: PathBuf) -> Result<Value, String> {
    let mut connection = connect(path)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let (revision, collections): (i64, String) = transaction.query_row("SELECT revision, collections FROM library_state WHERE id=1", [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|error| error.to_string())?;
    let mut statement = transaction.prepare("SELECT metadata, sgf, original_sgf FROM records ORDER BY rowid ASC").map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))).map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        let (text, sgf, original_sgf) = row.map_err(|error| error.to_string())?;
        let mut record: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
        record["sgf"] = Value::String(sgf);
        record["originalSgf"] = Value::String(original_sgf);
        records.push(record);
    }
    Ok(json!({ "version": 1, "revision": revision, "collections": serde_json::from_str::<Value>(&collections).map_err(|error| error.to_string())?, "records": records }))
}

fn save_database(path: PathBuf, data: Value) -> Result<(), String> {
    if data["version"] != 1 { return Err("不支持的棋谱库版本".into()); }
    let revision = data["revision"].as_i64().ok_or("缺少棋谱库版本号")?;
    let records = data["records"].as_array().ok_or("棋谱数据格式错误")?;
    let collections = data["collections"].as_array().ok_or("棋谱集数据格式错误")?;
    let mut connection = connect(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error| error.to_string())?;
    let current: i64 = transaction.query_row("SELECT revision FROM library_state WHERE id=1", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    if revision != current + 1 { return Err("棋谱库已被其他窗口更新，请刷新后重试".into()); }
    transaction.execute("DELETE FROM records", []).map_err(|error| error.to_string())?;
    for record in records {
        let id = record["id"].as_str().ok_or("棋谱缺少 ID")?;
        let sgf = record["sgf"].as_str().ok_or("棋谱缺少 SGF")?;
        let original = record["originalSgf"].as_str().ok_or("棋谱缺少原始 SGF")?;
        let mut metadata = record.clone();
        metadata.as_object_mut().ok_or("棋谱数据格式错误")?.remove("sgf");
        metadata.as_object_mut().unwrap().remove("originalSgf");
        transaction.execute("INSERT INTO records(id, metadata, sgf, original_sgf) VALUES(?1, ?2, ?3, ?4)", params![id, metadata.to_string(), sgf, original]).map_err(|error| error.to_string())?;
    }
    transaction.execute("UPDATE library_state SET revision=?1, collections=?2 WHERE id=1", params![revision, serde_json::to_string(collections).map_err(|error| error.to_string())?]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_load(app: tauri::AppHandle) -> Result<Value, String> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_database(path)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_save(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let path = database_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_database(path, data)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_read_files(paths: Vec<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.len() > 500 { return Err("一次最多导入 500 个文件".into()); }
        let mut files = Vec::new();
        for path in paths {
            let path = PathBuf::from(path);
            if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("sgf")) != Some(true) { continue; }
            let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
            if !metadata.is_file() || metadata.len() > 20 * 1024 * 1024 { return Err("仅支持不超过 20 MB 的 SGF 文件".into()); }
            let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
            files.push(json!({ "name": path.file_name().unwrap_or_default().to_string_lossy(), "bytes": bytes }));
        }
        Ok(Value::Array(files))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_export_file(contents: String, name: String, kind: String) -> Result<bool, String> {
    if !["sgf", "json"].contains(&kind.as_str()) { return Err("不支持的导出格式".into()); }
    let file = rfd::AsyncFileDialog::new().set_file_name(&name).add_filter(if kind == "sgf" { "SGF 棋谱" } else { "棋谱库备份" }, &[&kind]).save_file().await;
    let Some(file) = file else { return Ok(false); };
    let path = file.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, contents).map(|_| true).map_err(|error| error.to_string())).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_roundtrip_and_rejects_stale_writes() {
        let path = std::env::temp_dir().join(format!("shiguang-library-test-{}-{}.sqlite3", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut data = load_database(path.clone()).unwrap();
        data["revision"] = json!(1);
        data["records"] = json!([{ "id": "one", "title": "中文棋谱", "sgf": "(;GM[1])", "originalSgf": "(;GM[1])" }]);
        save_database(path.clone(), data.clone()).unwrap();
        assert_eq!(load_database(path.clone()).unwrap()["records"][0]["title"], "中文棋谱");
        assert!(save_database(path.clone(), data).is_err());
        let mut invalid = load_database(path.clone()).unwrap();
        invalid["revision"] = json!(2);
        invalid["records"] = json!([{ "id": "broken", "sgf": "(;GM[1])" }]);
        assert!(save_database(path.clone(), invalid).is_err());
        assert_eq!(load_database(path.clone()).unwrap()["records"][0]["id"], "one");
        let _ = std::fs::remove_file(path);
    }
}
