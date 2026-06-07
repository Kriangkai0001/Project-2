# ผนวก ค — Config และ Code ทั้งหมด

> Code จริงอยู่ใน folders: [`ml_pipeline/`](ml_pipeline/), [`chat_system/`](chat_system/), [`rag/`](rag/)

---

## ค.1 SNMP Config บนอุปกรณ์

### Router (RouterProject.mynetwork.com)
```
snmp-server group TelegrafGroup v3 priv read TelegrafView
snmp-server user TelegrafGroup TelegrafGroup v3 auth sha cyber@mut priv aes 128 cyber@mut
snmp-server view TelegrafView iso included
snmp-server host 192.168.99.89 version 3 priv TelegrafGroup
```

### Switch (PR-test-sw.netsec.local)
```
snmp-server group TelegrafGroup v3 priv write v1default
snmp-server user TelegrafUser TelegrafGroup v3 auth sha Netsec123 priv aes 128 PrivPass456
snmp-server view v1default iso included
snmp-server host 192.168.99.89 version 3 priv TelegrafGroup
```

---

## ค.2 Config Telegraf

**Path:** `/etc/telegraf/telegraf.conf`

### Output → PostgreSQL
```toml
[[outputs.postgresql]]
  connection = "postgres://netsec:Netsec123@localhost/edgedb?sslmode=disable"
```

### Input → SNMP Switch (192.168.99.88)
```toml
[[inputs.snmp]]
  agents        = ["192.168.99.88"]
  version       = 3
  sec_name      = "TelegrafUser"
  sec_level     = "authPriv"
  auth_protocol = "SHA"
  auth_password = "Netsec123"
  priv_protocol = "AES"
  priv_password = "PrivPass456"
  interval      = "5m"
  timeout       = "30s"
  retries       = 5

  [[inputs.snmp.field]]
    name = "hostname" ; oid = "1.3.6.1.2.1.1.5.0" ; is_tag = true
  [[inputs.snmp.field]]
    name = "uptime"   ; oid = "1.3.6.1.2.1.1.3.0"
  [[inputs.snmp.field]]
    name = "cpu_5s"   ; oid = "1.3.6.1.4.1.9.2.1.56.0"
  [[inputs.snmp.field]]
    name = "mem_used" ; oid = "1.3.6.1.4.1.9.9.48.1.1.1.5.1"
  [[inputs.snmp.field]]
    name = "mem_free" ; oid = "1.3.6.1.4.1.9.9.48.1.1.1.6.1"

  [[inputs.snmp.table]]
    name         = "interface"
    inherit_tags = ["hostname"]
    oid          = "1.3.6.1.2.1.2.2"
```

### Input → SNMP Router (192.168.99.1)
```toml
[[inputs.snmp]]
  agents        = ["192.168.99.1"]
  version       = 3
  sec_name      = "TelegrafGroup"
  sec_level     = "authPriv"
  auth_protocol = "SHA"
  auth_password = "cyber@mut"
  priv_protocol = "AES"
  priv_password = "cyber@mut"
  interval      = "5m"
  # fields เหมือน SW
```

### Input → Syslog UDP 6514
```toml
[[processors.regex]]
  namepass = ["syslog"]
  [[processors.regex.fields]]
    key         = "message"
    pattern     = '.*?(%[A-Z0-9_]+-\d-[A-Z0-9_]+:.*)'
    replacement = "${1}"

[[inputs.socket_listener]]
  service_address = "udp://:6514"
  data_format     = "grok"
  grok_patterns   = ['<%{NUMBER:priority}>%{NUMBER:seq}: %{IPORHOST:source}: %{DATA:ts}: (%{GREEDYDATA:message})']
  name_override   = "syslog"
```

---

## ค.3 Database Schema

### devices
```sql
device_id   integer     PK
hostname    varchar(100) UNIQUE
ip_address  inet
type        varchar(20)  -- 'SERVER' | 'SWITCH'
```

### monitored_devices
```sql
hostname     text  PK
device_type  text
ip           text
description  text
active       boolean  -- default true
```

### interfaces
```sql
interface_id   integer  PK
device_id      integer  FK → devices
interface_name varchar(100)
UNIQUE (device_id, interface_name)
```

### snmp
```sql
time        timestamp   -- ทุก 5 นาที
hostname    text        -- FQDN
cpu_5s      bigint      -- CPU % (5s average)
mem_free    bigint      -- bytes
mem_used    bigint      -- bytes
uptime      numeric     -- centiseconds
```

### snmp_hourly
```sql
time_bucket  timestamp  PK
hostname     text       PK
avg_cpu_5s   numeric(5,2)
max_cpu_5s   numeric(5,2)
avg_mem_used bigint
avg_mem_free bigint
uptime_max   numeric
```

### interface
```sql
time           timestamp
hostname       text
"ifName"       text        -- Gi0/1, Vlan10, Fa0/1
"ifOperStatus" bigint      -- 1=up, 2=down
"ifHighSpeed"  numeric     -- Mbps
"ifHCInOctets" numeric     -- bytes สะสม (counter)
"ifHCOutOctets" numeric
"ifInErrors"   numeric
"ifOutErrors"  numeric
vlan_id        bigint
```

### measure_switch_traffic
```sql
time          timestamp  PK
interface_id  integer    FK → interfaces
in_bytes      bigint
out_bytes     bigint
```

### syslog
```sql
time          timestamp
source        text       -- IP ต้นทาง
severity      text
severity_code integer    -- 0=emerg, 3=error, 4=warning, 6=info
message       text
```

### syslogs
```sql
log_id        integer  PK
time          timestamptz
device_id     integer  FK → devices
hostname      text
app_name      text
severity_code integer
facility_code integer
message       text
```

### syslogs_buffer
```sql
time          timestamptz
hostname      text
appname       text
severity_code integer
facility_code integer
message       text
tags          jsonb
fields        jsonb
-- TRIGGER: trg_process_syslog → ส่งต่อไป syslogs
```

### raw_telemetry_landing
```sql
time    timestamptz
tags    jsonb
fields  jsonb
-- TRIGGER: trigger_telemetry_etl → process_telemetry()
```

### ml_labels
```sql
id            integer  PK
time_start    timestamp
time_end      timestamp
hostname      text
scenario_id   integer
scenario_name text
description   text
created_at    timestamp
```

### ml_isolation_forest
```sql
time          timestamp
hostname      text
anomaly       integer     -- 1=anomaly, 0=normal
anomaly_label text
anomaly_score double
cpu_5s        double
mem_used      double      -- bytes
in_bps        double      -- bytes/s
out_bps       double
in_err_rate   double
scenario_name text
UNIQUE (time, hostname)
```

### ml_arima
```sql
time          timestamp
hostname      text
feature       text        -- cpu_5s/mem_used/in_bps/out_bps/in_err_rate/gap
actual        numeric
predicted     numeric
residual      numeric
threshold     numeric
anomaly       boolean
scenario_name text
UNIQUE (time, hostname, feature)
```

---

## ค.4 ML Pipeline Code

→ ดู code จริงใน [`ml_pipeline/`](ml_pipeline/)

### `export.py` — ดึงข้อมูล
```python
# JOIN snmp + interface บน hostname + เวลาใกล้เคียง
# คำนวณ bps จาก delta counter
# ดึงเฉพาะข้อมูลใหม่ตั้งแต่ timestamp ล่าสุดใน ml_isolation_forest
# Output: edge_data.csv
```

### `predict.py` — IsolationForest
```python
# โหลด model ตาม hostname
model  = load(f"models/{hostname}_iso_model.pkl")
scaler = load(f"models/{hostname}_iso_scaler.pkl")
X_scaled = scaler.transform(features)
anomaly  = model.predict(X_scaled)   # -1=anomaly, 1=normal

# Noise filter: ถ้า cpu<10% AND mem<10MB AND bps<1M AND err=0 → normal
# Assign scenario: scenario_classifier.predict(features)
```

### `predict_arima.py` — ARIMA Forecast
```python
# ต่อ feature ต่อ hostname:
#   ดึง historical 168 จุด → ARIMA(p,d,q).fit() → forecast 1 step
#   residual = actual - predicted
#   anomaly  = residual > threshold
# Gap detection: ไม่มีข้อมูลเกิน 15 นาที → gap_detected
```

### `train_save.py` — Retrain IsolationForest
```python
BASELINE_PERIODS = {
    'PR-test-sw.netsec.local'     : ('2026-04-11', '2026-04-20'),
    'RouterProject.mynetwork.com' : ('2026-03-31', '2026-04-09'),
}
# IsolationForest(contamination=0.05, n_estimators=100)
# บันทึกแยกต่อ hostname → models/{hostname}_iso_model.pkl
```

### `train_scenario_classifier.py` — Scenario Classifier
```python
# ดึงทุก anomaly row จาก ml_isolation_forest (ทั้งหมด ไม่จำกัดวัน)
# RandomForestClassifier(n_estimators=100, class_weight='balanced')
# evaluate 80/20 → retrain บน full data → scenario_classifier.pkl
```

---

## ค.5 Chat System Code

→ ดู code จริงใน [`chat_system/`](chat_system/)

### `server.js` — Chat API หลัก

**Routing Flow:**
```
คำถาม → rate limit → session lookup
  ├─ topology/protocol keyword → graph_service:5003
  ├─ "คืออะไร/explain/what is" → RAG:5002 → qwen วิเคราะห์
  ├─ match SQL Template (12 แบบ) → query DB → qwen วิเคราะห์
  └─ qwen สร้าง SQL → query DB → qwen วิเคราะห์
```

**SQL Templates 12 แบบ:**
```javascript
const SQL_TEMPLATES = [
  { pattern: /สถานะระบบ|system.*status/i,
    sql: `SELECT DISTINCT ON (s.hostname) s.hostname, s.cpu_5s,
          round((s.mem_used/1048576.0)::numeric,1) AS mem_mb,
          round((s.uptime/100.0/86400.0)::numeric,1) AS uptime_days
          FROM snmp s ORDER BY s.hostname, s.time DESC LIMIT 10` },
  { pattern: /cpu.*ล่าสุด|cpu.*ทุก/i,
    sql: `SELECT DISTINCT ON (hostname) hostname, cpu_5s, time
          FROM snmp ORDER BY hostname, time DESC LIMIT 10` },
  { pattern: /memory.*ล่าสุด|mem.*ล่าสุด/i,
    sql: `SELECT DISTINCT ON (hostname) hostname,
          round((mem_used/1048576.0)::numeric,1) AS mem_used_mb,
          round((mem_free/1048576.0)::numeric,1) AS mem_free_mb, time
          FROM snmp ORDER BY hostname, time DESC LIMIT 10` },
  // ... 9 แบบอื่น
];
```

### `config.js` — Prompts

→ ดู code จริงใน [`chat_system/config.js`](chat_system/config.js)

```javascript
SQL_SYSTEM_PROMPT    // สอน qwen DB schema + ตัวอย่าง SQL
ANALYST_SYSTEM_PROMPT // สอน qwen วิเคราะห์ผลเป็นภาษาไทย
QUICK_PROMPTS        // รายการ quick prompts บน UI
```

### `graph_service.py` — Knowledge Graph
```python
# rebuild ทุก 5 นาที จาก DB
# expose: /graph/summary/all, /graph/{device}, /graph/{device}/{protocol}
protocols = ['snmp', 'interface', 'syslog', 'anomaly_isolation', 'anomaly_arima']
```

---

## ค.6 RAG Code

→ ดู code จริงใน [`rag/`](rag/)

### `rag_service.py`
```python
# startup: โหลด faiss_index.bin + faiss_meta.pkl
# POST /query
#   question → embed (all-MiniLM-L6-v2)
#             → FAISS.search(embedding, top_5)
#             → return [{Q, A}, ...]
```

### `build_faiss.py`
```python
# อ่าน embed_p1.npz (TH Q+EN A) + embed_p2.npz (TH Q+TH A)
# normalize → FAISS IndexFlatIP
# บันทึก faiss_index.bin + faiss_meta.pkl
# รวม 550,774 vectors
```

---

## ค.7 Environment Variables

**Path:** `/opt/dashboard-grafana/.env`

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=edgedb
DB_USER=netsec
DB_PASSWORD=Netsec123
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_TIMEOUT=120000
RAG_URL=http://127.0.0.1:5002
GRAPH_URL=http://127.0.0.1:5003
PORT=5001
```
