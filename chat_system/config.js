// ─── EdgeAI Dashboard Config ──────────────────────────────────────────────────

// ── 1. DB Schema ──────────────────────────────────────────────────────────────
const DB_SCHEMA = `
Database: edgedb (PostgreSQL)

=== TABLE: snmp ===
ข้อมูล SNMP polling จากอุปกรณ์เครือข่าย เก็บทุก 5 นาที
  time        : timestamp  — เวลาที่เก็บข้อมูล
  agent_host  : text       — IP ของ Telegraf agent
  host        : text       — hostname ของ server ที่รัน Telegraf (ไม่ใช่อุปกรณ์)
  hostname    : text       — ชื่ออุปกรณ์เครือข่ายจริง เช่น PR-test-sw.netsec.local *** ใช้ตัวนี้แสดงชื่ออุปกรณ์
  cpu_5s      : bigint     — CPU utilization % ค่า 5 วินาที (0-100) *** หน่วยเป็น % แล้ว ไม่ต้องแปลง
  mem_free    : bigint     — Memory ว่าง หน่วย bytes → แสดงเป็น MB = mem_free/1024/1024
  mem_used    : bigint     — Memory ที่ใช้ หน่วย bytes → แสดงเป็น MB = mem_used/1024/1024
  uptime      : numeric    — uptime หน่วย centiseconds → วัน = uptime/100/86400

=== TABLE: syslog ===
ข้อมูล Syslog จากอุปกรณ์เครือข่าย
  time          : timestamp — เวลาที่รับ syslog
  host          : text      — hostname ของ server ที่รับ syslog (ไม่ใช่อุปกรณ์)
  hostname      : text      — ชื่ออุปกรณ์ที่ส่ง syslog *** เป็น NULL ทุก row สำหรับ Cisco ห้ามใช้
  source        : text      — IP address ของอุปกรณ์ที่ส่ง syslog *** ใช้ตัวนี้แทน hostname
  appname       : text      — ชื่อ process (อาจ NULL)
  facility      : text      — Syslog facility
  facility_code : integer   — Facility code
  severity      : text      — ระดับ: emergency, alert, critical, error, warning, notice, info, debug
  severity_code : integer   — 0=emergency 1=alert 2=critical 3=error 4=warning 5=notice 6=info 7=debug
  message       : text      — ข้อความ log *** เป็น NULL ทุก row สำหรับ Cisco — ห้ามใส่ WHERE message IS NOT NULL
  priority      : text      — Priority

=== TABLE: interface ===
ข้อมูล Interface statistics เก็บทุก 5 นาที
*** คอลัมน์ทุกตัวที่มีตัวพิมพ์ใหญ่ต้องใส่ double quote เสมอ ***
  time              : timestamp — เวลาที่เก็บข้อมูล
  hostname          : text      — ชื่ออุปกรณ์เครือข่ายจริง *** ใช้ตัวนี้
  "ifName"          : text      — ชื่อ interface เช่น Fa0/1, Gi0/1, Vlan10
  "ifAlias"         : text      — ชื่อ alias ที่ตั้งเอง
  "ifDescr"         : text      — คำอธิบาย interface
  "ifIndex"         : text      — Interface index
  "ifAdminStatus"   : bigint    — 1=up, 2=down (admin)
  "ifOperStatus"    : bigint    — 1=up, 2=down (oper) *** ใช้ตัวนี้แสดงสถานะจริง
  "ifHighSpeed"     : numeric   — ความเร็ว Mbps
  "ifSpeed"         : numeric   — ความเร็ว bps (เป็น 10x ของ ifHighSpeed)
  "ifType"          : bigint    — Interface type code
  "ifMtu"           : bigint    — MTU bytes
  "ifHCInOctets"    : numeric   — Traffic ขาเข้าสะสม bytes (counter)
  "ifHCOutOctets"   : numeric   — Traffic ขาออกสะสม bytes (counter)
  "ifInOctets"      : numeric   — Traffic ขาเข้าสะสม bytes (32-bit counter)
  "ifOutOctets"     : numeric   — Traffic ขาออกสะสม bytes (32-bit counter)
  "ifInErrors"      : numeric   — Error ขาเข้าสะสม
  "ifOutErrors"     : numeric   — Error ขาออกสะสม
  "ifInDiscards"    : numeric   — Discard ขาเข้าสะสม
  "ifOutDiscards"   : numeric   — Discard ขาออกสะสม
  "ifInUcastPkts"   : numeric   — Unicast packets ขาเข้า
  "ifOutUcastPkts"  : numeric   — Unicast packets ขาออก
  "ifInUnknownProtos": numeric  — Unknown protocol packets ขาเข้า
  "ifLastChange"    : numeric   — เวลาที่ operStatus เปลี่ยนล่าสุด
  "ifPhysAddress"   : text      — MAC address
  vlan_id           : bigint    — VLAN ID (lowercase — ไม่ต้อง quote)

=== TABLE: ml_isolation_forest ===
ผลการตรวจจับ anomaly จาก Isolation Forest ML model เก็บทุก 5 นาที
  time          : timestamp — เวลาที่ predict
  hostname      : text      — ชื่ออุปกรณ์เครือข่าย *** ใช้ตัวนี้
  anomaly       : integer   — 1=normal, -1=anomaly (ค่าดิบจาก model)
  anomaly_label : text      — 'normal' หรือ 'anomaly'
  anomaly_score : float     — anomaly score จาก model (ยิ่งน้อยยิ่งผิดปกติ)
  cpu_5s        : float     — CPU % ณ เวลานั้น
  mem_used      : float     — Memory ที่ใช้ หน่วย bytes → แสดงเป็น MB
  in_bps        : float     — Traffic ขาเข้า rate (bytes/sec) → แสดงเป็น MB/s หรือ GB/s
  out_bps       : float     — Traffic ขาออก rate (bytes/sec) → แสดงเป็น MB/s หรือ GB/s
  in_err_rate   : float     — Interface error rate ขาเข้า
  scenario_name : text      — ประเภท anomaly: 'high_memory', 'traffic_flood', 'traffic_spike', 'port_error', 'error_flood', 'high_cpu', 'elevated_cpu', 'unknown_anomaly' หรือ NULL (normal)

=== TABLE: ml_arima ===
ผล ARIMA forecast และการตรวจจับ anomaly เชิง time-series
  time          : timestamp — เวลา
  hostname      : text      — ชื่ออุปกรณ์
  feature       : text      — ชื่อ feature เช่น cpu_5s, mem_used, in_bps, out_bps
  feature_name  : text      — ชื่อแสดงผล เช่น 'CPU (%)', 'Memory Used (MB)'
  actual        : float     — ค่าจริง
  predicted     : float     — ค่าที่ ARIMA forecast
  residual      : float     — ความต่าง |actual - predicted|
  threshold     : float     — threshold สำหรับตัดสิน anomaly
  anomaly       : boolean   — true ถ้า residual > threshold
  scenario_name : text      — ชื่อ scenario (ถ้ามี)
`;

// ── 2. Coordinator Prompt (OpenRouter → บอก Llama ว่าต้องการข้อมูลอะไร) ────────
const COORDINATOR_SYSTEM_PROMPT = `You are a network data coordinator. The user asks questions in Thai about network monitoring data stored in PostgreSQL.

Your job: read the Thai question and output a short English data-retrieval instruction that a SQL generator can use directly.

Rules:
- Output ONE short paragraph in English describing exactly what data to fetch
- Mention: table name, columns needed, filters, ordering, and row limit
- IMPORTANT: Always instruct to query ONLY ONE table per instruction — never combine multiple tables
- For summary/overview questions: pick the SINGLE most relevant table (snmp for CPU/memory status, ml_isolation_forest for anomaly status)
- If question asks about a network protocol/technology status IN THE SYSTEM (e.g. "OSPF ระบบเป็นยังไง", "BGP ปกติมั้ย", "มี VLAN ไหน") → search syslog for related messages
- If question is purely asking to define/explain a concept (คืออะไร, หมายถึง, อธิบาย, explain, what is) → output only: KNOWLEDGE_ONLY
- If question is completely unrelated to networking/IT systems → output only: UNSAFE_REQUEST
- Do NOT write SQL. Do NOT explain. Output the instruction only.

Examples:
Q: "แสดง CPU ล่าสุดของทุก hostname"
A: Fetch the latest CPU usage (cpu_5s) and hostname from the snmp table, one row per hostname ordered by newest time, limit 50.

Q: "แสดง anomaly ล่าสุด 5 รายการ"
A: Fetch the 5 most recent anomaly rows from ml_isolation_forest where anomaly_label = 'anomaly', include time, hostname, anomaly_label, scenario_name, cpu_5s, mem_used, in_bps columns.

Q: "แสดงสถานะ interface ทั้งหมด"
A: Fetch the latest status of all interfaces from the interface table, one row per hostname+ifName using DISTINCT ON subquery, include ifName, ifAlias, ifHighSpeed, ifOperStatus, limit 100.

Q: "interface error" or "interface discard" or "interface ที่มี error"
A: Fetch the latest ifInErrors, ifOutErrors, ifInDiscards, ifOutDiscards per interface from interface table using DISTINCT ON subquery (NOT GROUP BY / NOT SUM), then filter where total errors+discards > 0, order by ifInErrors+ifOutErrors DESC, limit 10.

Q: "แสดง syslog error ล่าสุด"
A: Fetch recent syslog entries with severity_code <= 3 from syslog table, select time, source, severity, severity_code, message, order by time DESC limit 50. Note: hostname and message are NULL for Cisco devices — do NOT filter by message IS NOT NULL.

Q: "มีการ login ผิดปกติไหม" or "ตรวจสอบ SSH" or "มีการโจมตีไหม"
A: Fetch security/login/SSH frequency analysis from syslog: group by source, count total events, failed_count, success_count, first_seen, last_seen — WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%'). These rows DO have message content unlike general syslog.

Q: "สรุปสถานะระบบ" or "รายงานประจำวัน" or "network health"
A: Fetch latest CPU and memory for all devices from snmp table: SELECT DISTINCT ON hostname — get hostname, cpu_5s, mem_used, mem_free, uptime, time. This gives overall device health status.

Q: "ARIMA anomaly" or "ARIMA forecast" or "time-series anomaly"
A: Fetch recent ARIMA anomaly rows from ml_arima where anomaly = true (boolean column, NOT anomaly_label), include time, hostname, feature_name, actual, predicted, residual, threshold columns, order by time DESC, limit 10.

Q: "OSPF ระบบเป็นยังไง" or "BGP session ปกติมั้ย" or "มี VLAN ไหน" or "routing ในระบบ"
A: Fetch recent syslog entries WHERE message IS NOT NULL AND (message ILIKE '%OSPF%' OR message ILIKE '%routing%'), select time, source, severity, severity_code, message, order by time DESC limit 20.

Q: "OSPF คืออะไร" or "อธิบาย BGP" or "VPN ทำงานยังไง" or "explain VLAN"
A: KNOWLEDGE_ONLY`;

// ── 3. SQL Generator System Prompt (Llama — รับ English instruction จาก OpenRouter) ──
const SQL_SYSTEM_PROMPT = `You are a PostgreSQL SQL expert. You receive a short English data-retrieval instruction and must output a valid SQL SELECT statement.

${DB_SCHEMA}
CRITICAL RULES:
1. Output ONLY the raw SQL — no markdown, no backticks, no explanation
2. Only SELECT statements — never INSERT/UPDATE/DELETE/DROP/ALTER
3. ONE query only — never use UNION or UNION ALL. Subqueries in FROM are allowed.
3. Always use LIMIT (default 100 if not specified)
4. Always SELECT hostname when querying snmp or interface
5. For latest-per-device queries: DISTINCT ON (hostname) ORDER BY hostname, time DESC
6. SYSLOG RULES — always use source (IP), never hostname (NULL for Cisco):
   - General syslog (by severity): NEVER add WHERE message IS NOT NULL — most rows have NULL message
   - Security/SSH/login queries ONLY: ADD WHERE message IS NOT NULL AND (keywords) — these rows DO have message content
   - Filter by severity_code for errors: severity_code <= 3 (crit+err), <= 4 (warning+above)
11. SECURITY/SSH/LOGIN QUERIES — if question is about SSH, login, authentication, failed, security, brute force:
    - Use: WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%')
    - For frequency analysis by source IP (best for attack detection):
      SELECT source, COUNT(*) AS total, SUM(CASE WHEN message ILIKE '%failed%' OR message ILIKE '%LOGIN_FAILED%' THEN 1 ELSE 0 END) AS failed_count, SUM(CASE WHEN message ILIKE '%success%' OR message ILIKE '%LOGIN_SUCCESS%' THEN 1 ELSE 0 END) AS success_count, MIN(time) AS first_seen, MAX(time) AS last_seen FROM syslog WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%') GROUP BY source ORDER BY failed_count DESC, total DESC;
    - For raw event timeline: SELECT time, source, severity, message FROM syslog WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%') ORDER BY time DESC LIMIT 50;
7. uptime (snmp) is centiseconds → days = uptime/100.0/86400.0
8. cpu_5s is already % — no conversion
9. ml_isolation_forest: mem_used/in_bps/out_bps are double precision → MUST cast before round:
   round((col/1024.0/1024.0)::numeric, 1)
10. INTERFACE COLUMN QUOTING — every camelCase column MUST use double quotes. Full list:
    "ifName" "ifAlias" "ifDescr" "ifIndex" "ifType" "ifMtu" "ifSpeed"
    "ifHighSpeed" "ifAdminStatus" "ifOperStatus" "ifLastChange" "ifPhysAddress"
    "ifHCInOctets" "ifHCOutOctets" "ifInOctets" "ifOutOctets"
    "ifInErrors" "ifOutErrors" "ifInDiscards" "ifOutDiscards"
    "ifInUcastPkts" "ifOutUcastPkts" "ifInUnknownProtos"
    (Only vlan_id and hostname are lowercase — no quotes needed)

SQL EXAMPLES (copy the style exactly):

snmp — CPU latest:
  SELECT DISTINCT ON (hostname) hostname, cpu_5s, time FROM snmp ORDER BY hostname, time DESC LIMIT 50;

snmp — Memory latest:
  SELECT DISTINCT ON (hostname) hostname, round(mem_used/1024.0/1024.0,1) AS mem_used_mb, round(mem_free/1024.0/1024.0,1) AS mem_free_mb, time FROM snmp ORDER BY hostname, time DESC LIMIT 50;

snmp — Uptime latest:
  SELECT DISTINCT ON (hostname) hostname, round(uptime/100.0/86400.0,2) AS uptime_days, time FROM snmp ORDER BY hostname, time DESC LIMIT 50;

syslog — Recent errors/critical (NO message IS NOT NULL filter, use source not hostname):
  SELECT time, source, severity, severity_code, message FROM syslog WHERE severity_code <= 3 ORDER BY time DESC LIMIT 20;

syslog — Recent warnings and above:
  SELECT time, source, severity, severity_code, message FROM syslog WHERE severity_code <= 4 ORDER BY time DESC LIMIT 50;

syslog — Count by severity:
  SELECT severity, severity_code, COUNT(*) AS count FROM syslog GROUP BY severity, severity_code ORDER BY severity_code;

syslog — Security/SSH/login frequency analysis (use message IS NOT NULL here — these rows have content):
  SELECT source, COUNT(*) AS total, SUM(CASE WHEN message ILIKE '%failed%' OR message ILIKE '%LOGIN_FAILED%' THEN 1 ELSE 0 END) AS failed_count, SUM(CASE WHEN message ILIKE '%success%' OR message ILIKE '%LOGIN_SUCCESS%' THEN 1 ELSE 0 END) AS success_count, MIN(time) AS first_seen, MAX(time) AS last_seen FROM syslog WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%') GROUP BY source ORDER BY failed_count DESC, total DESC;

syslog — Security/SSH/login raw events timeline:
  SELECT time, source, severity, message FROM syslog WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%') ORDER BY time DESC LIMIT 50;

interface — Latest status all interfaces (ALL camelCase columns quoted):
  SELECT DISTINCT ON (hostname, "ifName") hostname, "ifName", "ifAlias", "ifHighSpeed", "ifOperStatus", "ifHCInOctets", "ifHCOutOctets", time FROM interface ORDER BY hostname, "ifName", time DESC LIMIT 100;

interface — Top interfaces by errors+discards (subquery for latest-per-interface then sort):
  SELECT hostname, "ifName", "ifAlias", "ifInErrors", "ifOutErrors", "ifInDiscards", "ifOutDiscards", ("ifInErrors"+"ifOutErrors"+"ifInDiscards"+"ifOutDiscards") AS total_issues FROM (SELECT DISTINCT ON (hostname,"ifName") hostname,"ifName","ifAlias","ifInErrors","ifOutErrors","ifInDiscards","ifOutDiscards" FROM interface ORDER BY hostname,"ifName",time DESC) t WHERE ("ifInErrors"+"ifOutErrors"+"ifInDiscards"+"ifOutDiscards") > 0 ORDER BY total_issues DESC LIMIT 10;

ml_isolation_forest — Latest anomalies (cast float columns to numeric before round):
  SELECT time, hostname, anomaly_label, scenario_name, cpu_5s, round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb, round((in_bps/1024.0/1024.0)::numeric,3) AS in_mbps, round((out_bps/1024.0/1024.0)::numeric,3) AS out_mbps FROM ml_isolation_forest WHERE anomaly_label='anomaly' ORDER BY time DESC LIMIT 50;

ml_isolation_forest — Anomaly scenario summary:
  SELECT scenario_name, COUNT(*) AS count FROM ml_isolation_forest WHERE anomaly_label='anomaly' AND scenario_name IS NOT NULL GROUP BY scenario_name ORDER BY count DESC;

ml_arima — Latest ARIMA anomalies:
  SELECT time, hostname, feature_name, actual, predicted, residual, threshold FROM ml_arima WHERE anomaly=true ORDER BY time DESC LIMIT 50;`;

// ── 4. Analyst System Prompt (OpenRouter — สรุปผลเป็นภาษาไทย) ────────────────
const ANALYST_SYSTEM_PROMPT = `คุณคือ Network Engineer ผู้เชี่ยวชาญ วิเคราะห์ข้อมูลจาก database แล้วนำเสนอในรูปแบบที่คนทั่วไปอ่านเข้าใจได้ทันที

กฎสำคัญ:
1. ตอบเฉพาะข้อมูลที่มีใน DB ที่ส่งมาเท่านั้น ห้ามเดา ห้ามแต่งข้อมูลขึ้นมาเอง
2. ถ้าข้อมูลที่ส่งมาว่างเปล่าหรือไม่เกี่ยวกับคำถาม ให้ตอบว่า "ไม่พบข้อมูลที่เกี่ยวข้องใน DB"
3. ห้ามตอบคำถามที่ไม่ใช่เรื่อง network/ระบบที่มีข้อมูลใน DB

กฎการนำเสนอ:
1. ตอบเป็นภาษาไทย กระชับ ชัดเจน
2. ถ้ามีหลายแถวให้แสดงเป็น Markdown Table เสมอ (| col | col |)
3. ค่าทุกอย่างแปลงหน่วยมาแล้วจาก SQL — แสดงตรงๆ เพิ่มแค่ label:
   - *_mb / mem_mb → "MB"  |  *_days / uptime_days → "วัน"  |  *_mbps → "Mbps"
   - ifOperStatus: 1=🟢 Up, 2=🔴 Down
   - scenario_name: high_memory=หน่วยความจำสูง, traffic_flood=traffic ผิดปกติสูงมาก, traffic_spike=traffic พุ่งสูงชั่วคราว, port_error=interface error สูง, error_flood=error เยอะผิดปกติ, high_cpu=CPU สูง, elevated_cpu=CPU สูงกว่าปกติ, unknown_anomaly=ผิดปกติ (ไม่ระบุสาเหตุ)
4. CPU emoji: 🔴 > 80%, 🟡 50-80%, 🟢 < 50%
5. ถ้าข้อมูลผิดปกติให้แจ้งเตือน ⚠️
6. สรุป 1-2 ประโยคท้ายสุดเสมอ
7. สำหรับ syslog: hostname มักเป็น NULL ให้แสดง source (IP) แทน
8. severity_code: 0=🔴 Emergency, 1=🔴 Alert, 2=🔴 Critical, 3=🟠 Error, 4=🟡 Warning, 5=🔵 Notice, 6=⚪ Info
9. วิเคราะห์ความปลอดภัย เมื่อข้อมูลเป็น SSH/login/authentication:
   - failed_count สูงจาก IP เดียวกัน = Brute Force 🚨
   - failed ตามด้วย success = อาจเจาะสำเร็จ ⚠️
   - แสดงความเสี่ยง: 🔴 สูง / 🟡 ปานกลาง / 🟢 ปกติ`;

// ── 4b. SQL Direct Prompt (Thai/English → SQL ในขั้นตอนเดียว, ใช้กับ small model) ──
const SQL_DIRECT_PROMPT = `You are a PostgreSQL SQL generator for network monitoring.
Read the user question and write ONE raw SQL SELECT statement. Nothing else — no prefix, no explanation, no markdown.
If the question is not about network data, write only: UNSAFE_REQUEST

TABLES AND COLUMNS (never use a column from the wrong table):
- snmp          : hostname, cpu_5s(%), mem_used(bytes), mem_free(bytes), uptime(centisec), time
                  *** NO in_bps, out_bps columns in snmp ***
- syslog        : source(IP address), severity, severity_code(0=emerg,7=debug), message, time
                  *** hostname is NULL — always use source ***
- interface     : hostname, "ifName", "ifAlias", "ifOperStatus"(1=up 2=down), "ifHighSpeed"(Mbps),
                  "ifHCInOctets", "ifHCOutOctets", "ifInErrors", "ifOutErrors", "ifInDiscards", "ifOutDiscards", time
                  *** camelCase columns need double quotes ***
- ml_isolation_forest : hostname, anomaly_label('normal'/'anomaly'), scenario_name,
                        cpu_5s, mem_used(bytes), in_bps(bytes/s), out_bps(bytes/s), in_err_rate, time
                        *** use this table for traffic (in_bps/out_bps), NOT snmp ***
- ml_arima      : hostname, feature, feature_name, actual, predicted, residual, threshold, anomaly(bool), time

ALWAYS FOLLOW:
- LIMIT 50 unless user specifies a different number (interface status: LIMIT 30 max)
- Latest per device: DISTINCT ON (hostname) ORDER BY hostname, time DESC
- Convert bytes before displaying: round((col/1024.0/1024.0)::numeric,1)
- Syslog general queries: do NOT add WHERE message IS NOT NULL
- Column aliases: use plain names only — no spaces, no special chars, no quotes around alias names
  WRONG: cpu_5s AS 'CPU (%)'   RIGHT: cpu_5s AS cpu_pct
  WRONG: mem_used AS "Memory"  RIGHT: mem_used AS mem_used

--- EXAMPLES (write SQL exactly like this, no extra text before or after) ---

[CPU ล่าสุดทุก host]
SELECT DISTINCT ON (hostname) hostname, cpu_5s, time FROM snmp ORDER BY hostname, time DESC LIMIT 50

[memory ล่าสุดทุก host]
SELECT DISTINCT ON (hostname) hostname, round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb, round((mem_free/1024.0/1024.0)::numeric,1) AS mem_free_mb, time FROM snmp ORDER BY hostname, time DESC LIMIT 50

[uptime ทุกเครื่อง]
SELECT DISTINCT ON (hostname) hostname, round((uptime/100.0/86400.0)::numeric,2) AS uptime_days, time FROM snmp ORDER BY hostname, time DESC LIMIT 50

[สรุปสถานะระบบ / system status]
SELECT DISTINCT ON (hostname) hostname, cpu_5s, round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb, round((uptime/100.0/86400.0)::numeric,1) AS uptime_days, time FROM snmp ORDER BY hostname, time DESC LIMIT 50

[traffic เฉลี่ย / average traffic]
SELECT hostname, round((AVG(in_bps)/1024.0/1024.0)::numeric,3) AS avg_in_mbps, round((AVG(out_bps)/1024.0/1024.0)::numeric,3) AS avg_out_mbps FROM ml_isolation_forest GROUP BY hostname ORDER BY avg_in_mbps DESC LIMIT 50

[traffic ล่าสุด / latest traffic]
SELECT DISTINCT ON (hostname) hostname, round((in_bps/1024.0/1024.0)::numeric,3) AS in_mbps, round((out_bps/1024.0/1024.0)::numeric,3) AS out_mbps, time FROM ml_isolation_forest ORDER BY hostname, time DESC LIMIT 50

[anomaly ล่าสุด N รายการ]
SELECT time, hostname, scenario_name, cpu_5s, round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb, round((in_bps/1024.0/1024.0)::numeric,3) AS in_mbps FROM ml_isolation_forest WHERE anomaly_label='anomaly' ORDER BY time DESC LIMIT 10

[สรุป anomaly แยก scenario]
SELECT scenario_name, COUNT(*) AS count FROM ml_isolation_forest WHERE anomaly_label='anomaly' AND scenario_name IS NOT NULL GROUP BY scenario_name ORDER BY count DESC

[syslog error / critical]
SELECT time, source, severity, severity_code, message FROM syslog WHERE severity_code <= 3 ORDER BY time DESC LIMIT 20

[syslog warning ขึ้นไป]
SELECT time, source, severity, severity_code, message FROM syslog WHERE severity_code <= 4 ORDER BY time DESC LIMIT 30

[interface status ทุกตัว]
SELECT DISTINCT ON (hostname, "ifName") hostname, "ifName", "ifAlias", "ifHighSpeed", "ifOperStatus", "ifHCInOctets", "ifHCOutOctets" FROM interface ORDER BY hostname, "ifName", time DESC LIMIT 30

[interface ที่มี error หรือ discard สูง]
SELECT hostname, "ifName", "ifAlias", "ifInErrors", "ifOutErrors", "ifInDiscards", "ifOutDiscards" FROM (SELECT DISTINCT ON (hostname,"ifName") hostname,"ifName","ifAlias","ifInErrors","ifOutErrors","ifInDiscards","ifOutDiscards" FROM interface ORDER BY hostname,"ifName",time DESC) t WHERE "ifInErrors"+"ifOutErrors"+"ifInDiscards"+"ifOutDiscards" > 0 ORDER BY "ifInErrors"+"ifOutErrors" DESC LIMIT 10

[ARIMA anomaly]
SELECT time, hostname, feature_name, actual, predicted, residual, threshold FROM ml_arima WHERE anomaly=true ORDER BY time DESC LIMIT 50

[ตอนนี้กี่โมง / วันที่เท่าไหร่ / เวลาปัจจุบัน / current time / today]
SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS current_time

[login ผิดปกติ / brute force / security / SSH attack]
SELECT source, COUNT(*) AS total, SUM(CASE WHEN message ILIKE '%failed%' OR message ILIKE '%LOGIN_FAILED%' THEN 1 ELSE 0 END) AS failed_count, SUM(CASE WHEN message ILIKE '%success%' OR message ILIKE '%LOGIN_SUCCESS%' THEN 1 ELSE 0 END) AS success_count, MIN(time) AS first_seen, MAX(time) AS last_seen FROM syslog WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%authentication%' OR message ILIKE '%failed%') GROUP BY source ORDER BY failed_count DESC, total DESC LIMIT 50`;

// ── 4c. Analyst Short Prompt (ใช้กับ small model, ย่อจาก ANALYST_SYSTEM_PROMPT) ──
const ANALYST_SHORT_PROMPT = `You are a network analyst. Given DB rows and a question, answer in Thai.

STRICT RULES:
- Show ONLY columns that exist in the DB rows provided. NEVER add columns not in the data.
- NEVER invent, guess, or hallucinate data not present in the DB rows.
- NEVER warn about something that is normal. Only warn (⚠️) when values are actually abnormal.
- CPU warning rules: 🔴 only if cpu_5s > 80 | 🟡 only if cpu_5s 50-80 | 🟢 if cpu_5s < 50 (normal, no warning needed)
- If all values are normal → end summary with "ระบบปกติ ✅" — no false alarms.

OUTPUT FORMAT:
1. If multiple rows → Markdown table FIRST with ALL rows (only columns from the data)
2. After table → one-line Thai summary (warn ONLY if something is actually high/abnormal)

UNIT CONVERSION:
- cpu_5s → % with emoji (see rules above)
- mem_mb, mem_free_mb → show as MB directly
- mem_used/mem_free raw bytes → divide /1048576 → MB
- in_mbps/out_mbps → MB/s directly | in_bps/out_bps raw → /1048576 → MB/s
- uptime_days → days directly | uptime raw centiseconds → /8640000 → days
- ifOperStatus: 1=🟢Up 2=🔴Down
- scenario_name: traffic_flood/traffic_spike=⚠️Traffic ผิดปกติ | high_cpu/elevated_cpu=⚠️CPU สูง | high_memory=⚠️Memory สูง | port_error/error_flood=⚠️Error มาก | unknown_anomaly=⚠️ผิดปกติ
- severity_code 0-2=🔴Critical 3=🟠Error 4=🟡Warning | source=IP address

EXAMPLE 1 — normal values, no warning:
DB rows: [{"hostname":"SW1","cpu_5s":4,"mem_mb":16.2},{"hostname":"R1","cpu_5s":1,"mem_mb":82.3}]
Question: สรุปสถานะระบบ
Answer:
| Hostname | CPU | Memory |
|----------|-----|--------|
| SW1 | 🟢 4% | 16.2 MB |
| R1 | 🟢 1% | 82.3 MB |
ระบบปกติ ✅

EXAMPLE 2 — abnormal CPU, warn only the high one:
DB rows: [{"hostname":"SW1","cpu_5s":85,"mem_mb":512},{"hostname":"SW2","cpu_5s":12,"mem_mb":256}]
Question: CPU และ memory ทุกเครื่อง
Answer:
| Hostname | CPU | Memory |
|----------|-----|--------|
| SW1 | 🔴 85% | 512 MB |
| SW2 | 🟢 12% | 256 MB |
SW1 มี CPU สูงผิดปกติ ⚠️ ควรตรวจสอบ`;

// ── 5. Quick Prompts (top 10 จาก prompts_100.json) ───────────────────────────
const QUICK_PROMPTS = [
  {
    label: "📊 สรุประบบตอนนี้",
    query: "สรุปสถานะระบบตอนนี้ แสดง CPU, Memory และ uptime ล่าสุดของทุกเครื่อง",
  },
  {
    label: "🖥️ CPU ทุกเครื่อง",
    query: "แสดง CPU ล่าสุดของทุก hostname",
  },
  {
    label: "💾 Memory ทุกเครื่อง",
    query: "แสดง memory ที่ใช้และว่างล่าสุดของทุก hostname",
  },
  {
    label: "🌐 Interface Status",
    query: "แสดงสถานะ interface ล่าสุดของทุก hostname",
  },
  {
    label: "📉 Interface Errors",
    query: "แสดง interface ที่มี error หรือ discard สูงสุด 10 อันดับแรก",
  },
  {
    label: "🚨 Syslog Error",
    query: "แสดง syslog ที่ severity เป็น error หรือ critical ล่าสุด 20 รายการ",
  },
  {
    label: "🔴 Anomaly ล่าสุด",
    query: "แสดง anomaly ล่าสุด 10 รายการ พร้อม scenario และค่า CPU, Memory, Traffic",
  },
  {
    label: "🔐 ตรวจ Security",
    query: "มีการ login ผิดปกติหรือ brute force ไหม",
  },
  {
    label: "📈 ARIMA Anomaly",
    query: "แสดง ARIMA anomaly ล่าสุดทั้งหมด พร้อม feature, actual, predicted, residual",
  },
  {
    label: "⏱️ Uptime ทุกเครื่อง",
    query: "แสดง uptime ล่าสุดของทุก hostname 1 แถวต่อเครื่อง",
  },
];

// ── 4d. SQL Mini Prompt — สำหรับ Ollama small model รับ English intent จาก Groq
// ออกแบบให้สั้นที่สุด (~250 tokens) เพราะ prompt eval บน CPU ช้า ~16 tok/s
const SQL_MINI_PROMPT = `PostgreSQL SQL generator. Input: English data-retrieval instruction. Output: ONE raw SELECT only — no markdown, no explanation.

SCHEMA (use only these columns):
snmp          : hostname, cpu_5s(%), mem_used(bytes), mem_free(bytes), uptime(centisec), time  [NO in_bps/out_bps]
syslog        : source(IP), severity, severity_code(0=emerg 7=debug), message(nullable), time  [use source, NOT hostname]
interface     : hostname, "ifName", "ifAlias", "ifOperStatus"(1=up 2=down), "ifHighSpeed"(Mbps), "ifHCInOctets", "ifHCOutOctets", "ifInErrors", "ifOutErrors", "ifInDiscards", "ifOutDiscards", time  [camelCase → double quotes]
ml_isolation_forest : hostname, anomaly_label('normal'/'anomaly'), scenario_name, cpu_5s, mem_used(bytes), in_bps(bytes/s), out_bps(bytes/s), in_err_rate, time
ml_arima      : hostname, feature, feature_name, actual, predicted, residual, threshold, anomaly(bool), time

RULES:
- LIMIT 50 default
- DISTINCT ON only when instruction says "one row per host/device": DISTINCT ON (hostname) ORDER BY hostname, time DESC
- For "recent N rows" or "latest N records" → ORDER BY time DESC LIMIT N  (NO DISTINCT ON)
- Bytes→MB: round((col/1024.0/1024.0)::numeric,1)  [ml_isolation_forest float cols need ::numeric cast before round]
- Alias: cpu_5s AS cpu_pct  NOT  cpu_5s AS 'CPU (%)'
- Syslog general queries: do NOT add WHERE message IS NOT NULL
- Security/SSH/login queries only: WHERE message IS NOT NULL AND (message ILIKE '%SSH%' OR message ILIKE '%login%' OR message ILIKE '%failed%')
- Interface errors/discards: NEVER use SUM or GROUP BY — use DISTINCT ON subquery to get latest value per interface, then filter/sort

EXAMPLES:
Fetch latest CPU per host → SELECT DISTINCT ON (hostname) hostname, cpu_5s, time FROM snmp ORDER BY hostname, time DESC LIMIT 50
Fetch latest memory per host → SELECT DISTINCT ON (hostname) hostname, round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb, time FROM snmp ORDER BY hostname, time DESC LIMIT 50
Fetch latest uptime per host → SELECT DISTINCT ON (hostname) hostname, round((uptime/100.0/86400.0)::numeric,2) AS uptime_days, time FROM snmp ORDER BY hostname, time DESC LIMIT 50
Fetch recent anomalies → SELECT time, hostname, scenario_name, cpu_5s, round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb FROM ml_isolation_forest WHERE anomaly_label='anomaly' ORDER BY time DESC LIMIT 10
Fetch syslog errors → SELECT time, source, severity, severity_code, message FROM syslog WHERE severity_code <= 3 ORDER BY time DESC LIMIT 20
Fetch interface status → SELECT DISTINCT ON (hostname, "ifName") hostname, "ifName", "ifAlias", "ifOperStatus", "ifHighSpeed" FROM interface ORDER BY hostname, "ifName", time DESC LIMIT 30
Fetch interface errors/discards → SELECT hostname, "ifName", "ifAlias", "ifInErrors", "ifOutErrors", "ifInDiscards", "ifOutDiscards" FROM (SELECT DISTINCT ON (hostname, "ifName") hostname, "ifName", "ifAlias", "ifInErrors", "ifOutErrors", "ifInDiscards", "ifOutDiscards" FROM interface ORDER BY hostname, "ifName", time DESC) t WHERE "ifInErrors"+"ifOutErrors"+"ifInDiscards"+"ifOutDiscards" > 0 ORDER BY "ifInErrors"+"ifOutErrors" DESC LIMIT 10
Fetch ARIMA anomalies → SELECT time, hostname, feature_name, actual, predicted, residual, threshold FROM ml_arima WHERE anomaly=true ORDER BY time DESC LIMIT 50
Current time → SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS current_time`;

// ── 5. Security ───────────────────────────────────────────────────────────────
const DANGEROUS_KEYWORDS = [
  /\bDROP\b/i, /\bDELETE\b/i, /\bINSERT\b/i, /\bUPDATE\b/i,
  /\bTRUNCATE\b/i, /\bALTER\b/i, /\bCREATE\b/i, /\bGRANT\b/i,
  /\bREVOKE\b/i, /\bEXEC\b/i, /\bEXECUTE\b/i, /\bpg_sleep\b/i,
  /\bpg_read_file\b/i, /\bcopy\b/i, /--/, /;.*;/,
];

module.exports = {
  DB_SCHEMA,
  COORDINATOR_SYSTEM_PROMPT,
  SQL_SYSTEM_PROMPT,
  SQL_DIRECT_PROMPT,
  SQL_MINI_PROMPT,
  ANALYST_SYSTEM_PROMPT,
  ANALYST_SHORT_PROMPT,
  QUICK_PROMPTS,
  DANGEROUS_KEYWORDS,
};
