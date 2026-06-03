# REFERENCE — ข้อมูลอ้างอิง

> อัพเดต: 2026-06-03

---

## 1. Database

### Connection
```
Host:     localhost (10.252.209.28)
Port:     5432
DB:       edgedb
User:     netsec
Password: Netsec123
```

### Schema: snmp
```sql
time        timestamp   -- เวลาที่เก็บข้อมูล (ทุก 5 นาที)
agent_host  text        -- IP ของ SNMP agent
host        text        -- hostname แบบสั้น
hostname    text        -- FQDN เช่น PR-test-sw.netsec.local
cpu_5s      bigint      -- CPU usage % (5s average)
mem_free    bigint      -- RAM ว่าง (bytes)
mem_used    bigint      -- RAM ใช้อยู่ (bytes)
uptime      numeric     -- uptime (centiseconds)

INDEX: (hostname, time)
ข้อมูล: 44,959 rows | Feb 2026 – Jun 2026
```

### Schema: interface
```sql
time              timestamp
hostname          text
ifName            text        -- ชื่อ port เช่น Gi0/1, Vlan10
ifAlias           text        -- ชื่อที่ตั้งเอง
ifIndex           text
ifDescr           text
ifAdminStatus     bigint      -- 1=up, 2=down (config)
ifOperStatus      bigint      -- 1=up, 2=down (จริง)
ifHighSpeed       numeric     -- ความเร็ว Mbps
ifSpeed           numeric     -- ความเร็ว bps
ifHCInOctets      numeric     -- bytes เข้า (High Capacity)
ifHCOutOctets     numeric     -- bytes ออก (High Capacity)
ifInOctets        numeric     -- bytes เข้า
ifOutOctets       numeric     -- bytes ออก
ifInErrors        numeric     -- error เข้า
ifOutErrors       numeric     -- error ออก
ifInDiscards      numeric
ifOutDiscards     numeric
ifInUcastPkts     numeric
ifOutUcastPkts    numeric
ifInUnknownProtos numeric
ifLastChange      numeric
ifMtu             bigint
ifPhysAddress     text        -- MAC address
ifType            bigint
vlan_id           bigint

INDEX: (hostname, time)
ข้อมูล: 1,653,116 rows
```

### Schema: syslog
```sql
time          timestamp
hostname      text
host          text
appname       text
facility      text
facility_code integer
severity      text        -- emergency/alert/critical/error/warning/notice/info/debug
severity_code integer
message       text        -- เนื้อหา log
source        text        -- IP ต้นทาง
priority      text
seq           text
ts            text
timestamp     bigint

INDEX: (host), (time DESC)
ข้อมูล: 5,562 rows
```

### Schema: ml_isolation_forest
```sql
id            integer     PRIMARY KEY
time          timestamp   NOT NULL
hostname      text
anomaly       integer     -- 1=anomaly, 0=normal
anomaly_label text        -- "anomaly" หรือ "normal"
anomaly_score double      -- score จาก IsolationForest (ยิ่งลบยิ่งผิดปกติ)
cpu_5s        double      -- ค่า CPU ที่วัดได้
mem_used      double      -- ค่า RAM ที่วัดได้ (bytes)
in_bps        double      -- traffic ขาเข้า bps
out_bps       double      -- traffic ขาออก bps
in_err_rate   double      -- error rate ขาเข้า
in_util_pct   double      -- % utilization ขาเข้า
scenario_id   integer
scenario_name text        -- high_memory/traffic_flood/port_error/high_cpu/...
created_at    timestamp

UNIQUE: (time, hostname)
ข้อมูล: 44,949 rows | Feb 2026 – Jun 2026
```

### Schema: ml_arima
```sql
id            integer     PRIMARY KEY
time          timestamp   NOT NULL
hostname      text        NOT NULL
feature       text        NOT NULL  -- cpu_5s/mem_used/in_bps/out_bps/in_err_rate/gap
feature_name  text        -- ชื่อแสดงผล
actual        numeric     -- ค่าจริง
predicted     numeric     -- ค่าที่ ARIMA คาดการณ์
residual      numeric     -- actual - predicted
threshold     numeric     -- เกินนี้ = anomaly
anomaly       boolean     -- true/false
scenario_name text
created_at    timestamp

UNIQUE: (time, hostname, feature)
ข้อมูล: 223,682 rows | Feb 2026 – Jun 2026
```

### Schema: monitored_devices
```sql
hostname    text    PRIMARY KEY
device_type text    -- switch/router
ip          text
description text
active      boolean DEFAULT true

ข้อมูล:
  PR-test-sw.netsec.local     | switch | 192.168.204.88 | Cisco 2960 L2 SW
  RouterProject.mynetwork.com | router | 192.168.99.1   | Router Project
```

---

## 2. Services & Ports

| Service | Port | Process | Path |
|---------|------|---------|------|
| Grafana Dashboard | 3000 | grafana-server | /var/lib/grafana |
| Chat API | 5001 | node (PM2) | /opt/dashboard-grafana/server.js |
| RAG Service | 5002 | python3 | /opt/net-chat/rag/rag_service.py |
| Graph Service | 5003 | python3 | /opt/dashboard-grafana/graph_service.py |
| PostgreSQL | 5432 | postgres | edgedb |
| Ollama | 11434 | ollama | /usr/local/bin/ollama |
| n8n | 5678 | node | (netsec user) |

---

## 3. LLM Models (Ollama)

| Model | ขนาด | ใช้งาน |
|-------|------|-------|
| qwen2.5:1.5b | ~1GB | **ใช้งานหลัก** — SQL gen + analyze |
| qwen2.5:3b | ~2GB | สำรอง |
| llama3.1:latest | ~4.7GB | สำรอง |

---

## 4. ARIMA Thresholds

```json
{
  "mem_used": 10338.012750493628
}
```
*(threshold เดียวที่ใช้อยู่ — คำนวณจาก baseline April 2026)*

---

## 5. ML Scenario Names

| scenario_name | เงื่อนไขหลัก | count ใน DB |
|---------------|------------|------------|
| high_memory | mem_used > threshold | 4,919 |
| traffic_flood | in_bps สูงเทียบ ifSpeed | 1,615 |
| traffic_spike | in_bps พุ่งสูงชั่วคราว | 693 |
| traffic_high | traffic สูงต่อเนื่อง | 68 |
| port_error | in_err_rate > 0 | 38 |
| link_congestion | congestion บน link | 34 |
| error_flood | error rate สูงต่อเนื่อง | 24 |
| elevated_cpu | CPU เพิ่มขึ้นต่อเนื่อง | 19 |
| unknown_anomaly | ตรวจจับได้แต่จำแนกไม่ได้ | 12 |
| high_cpu | cpu_5s > 80 | 1 |

---

## 6. RAG Knowledge Base

| ไฟล์ | ขนาด | เนื้อหา |
|------|------|--------|
| faiss_index.bin | 807MB | FAISS vector index |
| faiss_meta.pkl | 445MB | Q+A metadata |
| combined_th_full.jsonl | 809MB | 236,568 pairs Thai |
| embed_p1.npz | 676MB | English vectors |
| embed_p2.npz | 667MB | Thai vectors |

**แหล่งข้อมูล training:**
- Stack Overflow / serverfault — network Q&A
- security.stackexchange.com
- networkengineering.stackexchange.com
- SNMP special topics
- Reddit (r/networking, r/sysadmin)
- Vendor docs (Cisco, Aruba, UniFi, MikroTik, Fortinet)

**Embed model:** all-MiniLM-L6-v2
**Total vectors:** 550,774 (English 314k + Thai 236k)

---

## 7. Environment Variables (.env)

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=edgedb
DB_USER=netsec
DB_PASSWORD=Netsec123
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:1.5b
OLLAMA_TIMEOUT=120000
RAG_URL=http://127.0.0.1:5002
GRAPH_URL=http://127.0.0.1:5003
PORT=5001
```

---

## 8. Hardware

```
Server:    Intel Core i7-7567U (2 core / 4 thread @ 3.5GHz)
RAM:       7.6GB
OS:        Ubuntu 24.04.3 LTS (kernel 6.8.0-111-generic)
IP:        10.252.209.28

โน้ตบุ๊ค QWJ (ใช้ช่วยประมวลผล):
CPU:       Intel Core i5-13420H (8 core / 16 thread)
RAM:       16GB
OS:        Ubuntu (dual boot) / Windows 11
IP:        10.252.209.156
```
