# SETUP — ขั้นตอนการติดตั้งระบบตั้งแต่ต้น

> ใช้เป็นเอกสารอ้างอิงสำหรับ Project 2

---

## อุปกรณ์ที่ใช้

| อุปกรณ์ | Spec | IP | หน้าที่ |
|---------|------|-----|--------|
| Server (Ubuntu) | Intel i7-7567U, RAM 7.6GB | 10.252.209.28 | รัน Telegraf, PostgreSQL, Grafana, ML, Chat |
| Cisco 2960 L2 SW | - | 192.168.99.88 / 192.168.204.88 | อุปกรณ์ที่ monitor |
| Router Project | - | 192.168.99.1 | อุปกรณ์ที่ monitor |

---

## Step 1 — ติดตั้ง OS (Ubuntu Server 24.04)

```bash
# อัพเดต OS
apt update && apt upgrade -y

# ติดตั้ง tools พื้นฐาน
apt install -y curl wget git python3 python3-pip python3-venv \
               build-essential net-tools vim
```

---

## Step 2 — Config อุปกรณ์ Network (Cisco)

### 2.1 เปิด SNMP v3 บน Switch (192.168.99.88)
```
! สร้าง SNMP v3 user
snmp-server group TelegrafGroup v3 priv
snmp-server user TelegrafUser TelegrafGroup v3 auth sha Netsec123 priv aes 128 PrivPass456

! เปิด Syslog ส่งมาที่ server
logging host 10.252.209.28 transport udp port 6514
logging trap informational
logging on
```

### 2.2 เปิด SNMP v3 บน Router (192.168.99.1)
```
! สร้าง SNMP v3 user
snmp-server group TelegrafGroup v3 priv
snmp-server user TelegrafGroup TelegrafGroup v3 auth sha cyber@mut priv aes 128 cyber@mut

! เปิด Syslog
logging host 10.252.209.28 transport udp port 6514
logging trap informational
logging on
```

---

## Step 3 — ติดตั้ง PostgreSQL

```bash
# ติดตั้ง PostgreSQL 16
apt install -y postgresql postgresql-client

# เริ่ม service
systemctl enable postgresql
systemctl start postgresql

# สร้าง user และ database
sudo -u postgres psql << 'EOF'
CREATE USER netsec WITH PASSWORD 'Netsec123';
CREATE DATABASE edgedb OWNER netsec;
GRANT ALL PRIVILEGES ON DATABASE edgedb TO netsec;
EOF
```

### 3.1 สร้าง Tables หลัก

```sql
-- ต่อเป็น user netsec
-- PGPASSWORD=Netsec123 psql -U netsec -d edgedb

-- Table: monitored_devices
CREATE TABLE monitored_devices (
    hostname    TEXT PRIMARY KEY,
    device_type TEXT,
    ip          TEXT,
    description TEXT,
    active      BOOLEAN DEFAULT true
);

-- เพิ่มอุปกรณ์
INSERT INTO monitored_devices VALUES
  ('PR-test-sw.netsec.local',     'switch', '192.168.204.88', 'Cisco 2960 L2 SW'),
  ('RouterProject.mynetwork.com', 'router', '192.168.99.1',   'Router Project');

-- Table: ml_isolation_forest
CREATE TABLE ml_isolation_forest (
    id            SERIAL PRIMARY KEY,
    time          TIMESTAMP NOT NULL,
    hostname      TEXT,
    anomaly       INTEGER,
    anomaly_label TEXT,
    anomaly_score DOUBLE PRECISION,
    cpu_5s        DOUBLE PRECISION,
    mem_used      DOUBLE PRECISION,
    in_bps        DOUBLE PRECISION,
    out_bps       DOUBLE PRECISION,
    in_err_rate   DOUBLE PRECISION,
    in_util_pct   DOUBLE PRECISION,
    scenario_id   INTEGER,
    scenario_name TEXT,
    created_at    TIMESTAMP DEFAULT now(),
    UNIQUE (time, hostname)
);

-- Table: ml_arima
CREATE TABLE ml_arima (
    id            SERIAL PRIMARY KEY,
    time          TIMESTAMP NOT NULL,
    hostname      TEXT NOT NULL,
    feature       TEXT NOT NULL,
    feature_name  TEXT,
    actual        NUMERIC,
    predicted     NUMERIC,
    residual      NUMERIC,
    threshold     NUMERIC,
    anomaly       BOOLEAN,
    scenario_name TEXT,
    created_at    TIMESTAMP DEFAULT now(),
    UNIQUE (time, hostname, feature)
);
```

> หมายเหตุ: tables `snmp`, `interface`, `syslog` ถูกสร้างอัตโนมัติโดย Telegraf

---

## Step 4 — ติดตั้ง Telegraf

```bash
# เพิ่ม repo
curl -s https://repos.influxdata.com/influxdata-archive.key | apt-key add -
echo "deb https://repos.influxdata.com/ubuntu focal stable" > /etc/apt/sources.list.d/influxdata.list
apt update && apt install -y telegraf

systemctl enable telegraf
```

### 4.1 Config Telegraf (`/etc/telegraf/telegraf.conf`)

**Output → PostgreSQL:**
```toml
[[outputs.postgresql]]
  connection = "postgres://netsec:Netsec123@localhost/edgedb?sslmode=disable"
```

**Input → SNMP Switch (192.168.99.88):**
```toml
[[inputs.snmp]]
  agents   = ["192.168.99.88"]
  version  = 3
  sec_name = "TelegrafUser"
  sec_level = "authPriv"
  auth_protocol = "SHA"
  auth_password = "Netsec123"
  priv_protocol = "AES"
  priv_password = "PrivPass456"
  interval = "5m"
  timeout  = "30s"
  retries  = 5

  # System fields
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

  # Interface table
  [[inputs.snmp.table]]
    name = "interface"
    inherit_tags = ["hostname"]
    oid  = "1.3.6.1.2.1.2.2"
    # ifName, ifAlias, ifOperStatus, ifAdminStatus
    # ifHCInOctets, ifHCOutOctets, ifHighSpeed
    # ifInErrors, ifOutErrors, ifType, vlan_id
```

**Input → SNMP Router (192.168.99.1):**
```toml
[[inputs.snmp]]
  agents   = ["192.168.99.1"]
  version  = 3
  sec_name = "TelegrafGroup"
  sec_level = "authPriv"
  auth_protocol = "SHA"
  auth_password = "cyber@mut"
  priv_protocol = "AES"
  priv_password = "cyber@mut"
  interval = "5m"
  # (fields เหมือน SW)
```

**Input → Syslog (UDP 6514):**
```toml
[[processors.regex]]
  namepass = ["syslog"]
  [[processors.regex.fields]]
    key = "message"
    pattern = '.*?(%[A-Z0-9_]+-\d-[A-Z0-9_]+:.*)'
    replacement = "${1}"

[[inputs.socket_listener]]
  service_address = "udp://:6514"
  data_format     = "grok"
  grok_patterns   = ['<%{NUMBER:priority}>%{NUMBER:seq}: %{IPORHOST:source}: %{DATA:ts}: (%{GREEDYDATA:message})']
  name_override   = "syslog"
```

```bash
# restart telegraf
systemctl restart telegraf
systemctl status telegraf

# ตรวจสอบว่าข้อมูลเข้า DB
PGPASSWORD=Netsec123 psql -U netsec -d edgedb -c "SELECT COUNT(*) FROM snmp"
```

---

## Step 5 — ติดตั้ง Grafana

```bash
apt install -y grafana
systemctl enable grafana-server
systemctl start grafana-server
```

### 5.1 Config (`/etc/grafana/grafana.ini`)
```ini
[server]
protocol  = http
http_port = 8888

[database]
; ใช้ SQLite (default)
```

### 5.2 เพิ่ม Datasource (edgedb)
เข้า Grafana UI → Configuration → Data Sources → Add:
```
Type:     PostgreSQL
Host:     localhost:5432
Database: edgedb
User:     netsec
Password: Netsec123
SSL Mode: disable
Version:  16
```

### 5.3 Import Dashboard
- นำเข้า dashboard JSON ผ่าน Grafana UI
- Dashboard หลัก: `edgenet-ai-2` — แสดง ML anomaly, ARIMA forecast, chat panel

---

## Step 6 — ติดตั้ง Python Environment (ML)

```bash
# สร้าง venv
python3 -m venv /opt/net-model/venv

# ติดตั้ง packages
/opt/net-model/venv/bin/pip install \
    scikit-learn==1.8.0 \
    pandas==2.3.3 \
    numpy==2.4.3 \
    psycopg2-binary==2.9.11 \
    statsmodels==0.14.6 \
    mlflow==3.10.1
```

### 6.1 เทรน Model ครั้งแรก

```bash
cd /opt/net-model

# 1. ดึงข้อมูล baseline (April — ช่วง anomaly rate ต่ำสุด)
venv/bin/python3 export.py

# 2. เทรน IsolationForest
venv/bin/python3 train_save.py
# → สร้าง models/PR-test-sw_netsec_local_iso_model.pkl
# → สร้าง models/RouterProject_mynetwork_com_iso_model.pkl

# 3. คำนวณ ARIMA threshold
venv/bin/python3 train_arima_threshold.py
# → สร้าง models/arima_thresholds.json

# 4. เทรน Scenario Classifier
venv/bin/python3 train_scenario_classifier.py
# → สร้าง models/scenario_classifier.pkl
```

### 6.2 ตั้ง Cron

```bash
crontab -e
```

```cron
# Inference ทุก 15 นาที
*/15 * * * * /opt/net-model/venv/bin/python3 /opt/net-model/export.py && \
             /opt/net-model/venv/bin/python3 /opt/net-model/predict.py && \
             /opt/net-model/venv/bin/python3 /opt/net-model/insert_result.py && \
             /opt/net-model/venv/bin/python3 /opt/net-model/predict_arima.py && \
             /opt/net-model/venv/bin/python3 /opt/net-model/insert_arima.py \
             >> /var/log/ml_pipeline.log 2>&1

# Retrain ทุกอาทิตย์ (อาทิตย์ ตี 1)
0 1 * * 0  /opt/net-model/venv/bin/python3 /opt/net-model/train_save.py && \
           /opt/net-model/venv/bin/python3 /opt/net-model/train_arima_threshold.py && \
           /opt/net-model/venv/bin/python3 /opt/net-model/train_scenario_classifier.py \
           >> /var/log/ml_train.log 2>&1
```

---

## Step 7 — ติดตั้ง Chat System

### 7.1 ติดตั้ง Node.js + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

cd /opt/dashboard-grafana
npm install
```

### 7.2 ติดตั้ง Ollama + Model

```bash
# ติดตั้ง Ollama
curl -fsSL https://ollama.com/install.sh | sh

# โหลด model
ollama pull qwen2.5:1.5b
```

### 7.3 สร้าง `.env`

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

### 7.4 รัน Services

```bash
# Chat API (PM2)
pm2 start /opt/dashboard-grafana/server.js --name dashboard-api
pm2 save
pm2 startup

# RAG Service
cd /opt/net-chat/rag
nohup /opt/net-chat/train-model-chat/venv/bin/python3 rag_service.py &

# Graph Service
nohup /opt/net-chat/train-model-chat/venv/bin/python3 /opt/dashboard-grafana/graph_service.py &
```

---

## Step 8 — ติดตั้ง RAG Knowledge Base

### 8.1 ติดตั้ง Python packages

```bash
pip install sentence-transformers faiss-cpu chromadb fastapi uvicorn
```

### 8.2 เตรียม Training Data

```bash
# ดาวน์โหลด Stack Exchange network data
# ไฟล์ที่ต้องการ: combined.jsonl (~257MB)
# จาก: serverfault, security SE, networkengineering SE, SNMP topics

# path: /opt/net-chat/train-model-chat/data/vendor/combined.jsonl
```

### 8.3 สร้าง FAISS Index

```bash
cd /opt/net-chat/rag

# สร้าง index จาก ChromaDB + Thai embeddings
python3 build_faiss.py
# → faiss_index.bin (807MB)
# → faiss_meta.pkl (445MB)
# → 550,774 vectors รวม EN + TH
```

---

## สรุป Services ที่ต้องรัน

```bash
# ตรวจสอบ
systemctl status telegraf      # SNMP collector
systemctl status postgresql    # Database
systemctl status grafana-server # Dashboard
pm2 status                     # Chat API
ps aux | grep rag_service      # RAG
ps aux | grep graph_service    # Graph
curl localhost:11434/api/tags  # Ollama
```

## Port สรุป

| Service | Port |
|---------|------|
| Grafana | 8888 |
| Chat API | 5001 |
| RAG Service | 5002 |
| Graph Service | 5003 |
| PostgreSQL | 5432 |
| Ollama | 11434 |
| Syslog (UDP) | 6514 |
