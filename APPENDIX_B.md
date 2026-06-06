# ผนวก ข — การติดตั้ง Services ทั้งหมด

> แต่ละขั้นตอนมี link ไปยัง config/code จริง

---

## ข.1 PostgreSQL

```bash
apt install -y postgresql postgresql-client
systemctl enable postgresql
systemctl start postgresql

sudo -u postgres psql << 'EOF'
CREATE USER netsec WITH PASSWORD 'Netsec123';
CREATE DATABASE edgedb OWNER netsec;
GRANT ALL PRIVILEGES ON DATABASE edgedb TO netsec;
EOF
```

### สร้าง Tables ML
```bash
PGPASSWORD=Netsec123 psql -U netsec -d edgedb
```

```sql
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

CREATE TABLE monitored_devices (
    hostname    TEXT PRIMARY KEY,
    device_type TEXT,
    ip          TEXT,
    description TEXT,
    active      BOOLEAN DEFAULT true
);

INSERT INTO monitored_devices VALUES
  ('PR-test-sw.netsec.local',     'switch', '192.168.204.88', 'Cisco 2960 L2 SW'),
  ('RouterProject.mynetwork.com', 'router', '192.168.99.1',   'Router Project');
```

> Tables `snmp`, `interface`, `syslog` — สร้างอัตโนมัติโดย Telegraf

---

## ข.2 Telegraf

```bash
curl -s https://repos.influxdata.com/influxdata-archive.key | apt-key add -
echo "deb https://repos.influxdata.com/ubuntu focal stable" > /etc/apt/sources.list.d/influxdata.list
apt update && apt install -y telegraf
systemctl enable telegraf
```

### Config หลัก (`/etc/telegraf/telegraf.conf`)
→ ดู config เต็มใน [ผนวก ค — Config Telegraf](#ค2-config-telegraf)

```bash
systemctl restart telegraf
# ตรวจสอบข้อมูลเข้า DB
PGPASSWORD=Netsec123 psql -U netsec -d edgedb -c "SELECT COUNT(*) FROM snmp"
```

---

## ข.3 Grafana

```bash
apt install -y grafana
systemctl enable grafana-server
systemctl start grafana-server
```

### Config (`/etc/grafana/grafana.ini`)
```ini
[server]
protocol  = http
http_port = 8888
```

### เพิ่ม Datasource
Grafana UI → Configuration → Data Sources → Add PostgreSQL:
```
Host:     localhost:5432
Database: edgedb
User:     netsec
Password: Netsec123
SSL Mode: disable
Version:  16
```

---

## ข.4 Python venv — ML Pipeline

```bash
python3 -m venv /opt/net-model/venv
/opt/net-model/venv/bin/pip install \
    scikit-learn==1.8.0 \
    pandas==2.3.3 \
    numpy==2.4.3 \
    psycopg2-binary==2.9.11 \
    statsmodels==0.14.6 \
    mlflow==3.10.1
```

### เทรน Model ครั้งแรก
```bash
cd /opt/net-model
venv/bin/python3 export.py                   # ดึงข้อมูล → edge_data.csv
venv/bin/python3 train_save.py               # → models/*.pkl
venv/bin/python3 train_arima_threshold.py    # → models/arima_thresholds.json
venv/bin/python3 train_scenario_classifier.py # → models/scenario_classifier.pkl
```

→ Code จริงอยู่ใน [`ml_pipeline/`](ml_pipeline/)

### ตั้ง Cron
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

## ข.5 Node.js + PM2 (Chat API)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

cd /opt/dashboard-grafana
npm install
```

### สร้าง `.env`
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

### รัน
```bash
pm2 start /opt/dashboard-grafana/server.js --name dashboard-api
pm2 save
pm2 startup
```

→ Code จริงอยู่ใน [`chat_system/server.js`](chat_system/server.js)

---

## ข.6 Ollama + LLM Model

```bash
curl -fsSL https://ollama.com/install.sh | sh

# โหลด model หลัก
ollama pull qwen2.5:3b

# ตรวจสอบ
curl localhost:11434/api/tags
```

| Model | ขนาด | ใช้งาน |
|-------|------|-------|
| qwen2.5:3b | ~2GB | **หลัก** — SQL gen + วิเคราะห์ผล |
| qwen2.5:1.5b | ~1GB | สำรอง |
| llama3.1:latest | ~4.7GB | สำรอง |

---

## ข.7 Python venv — RAG + Chat Services

```bash
python3 -m venv /opt/net-chat/train-model-chat/venv
/opt/net-chat/train-model-chat/venv/bin/pip install \
    sentence-transformers \
    faiss-cpu \
    fastapi \
    uvicorn \
    numpy \
    psycopg2-binary
```

### รัน RAG Service
```bash
cd /opt/net-chat/rag
nohup /opt/net-chat/train-model-chat/venv/bin/python3 rag_service.py \
      > /opt/net-chat/rag/rag.log 2>&1 &
```

→ Code จริงอยู่ใน [`rag/rag_service.py`](rag/rag_service.py)

### รัน Graph Service
```bash
nohup /opt/net-chat/train-model-chat/venv/bin/python3 \
      /opt/dashboard-grafana/graph_service.py \
      > /opt/dashboard-grafana/graph.log 2>&1 &
```

→ Code จริงอยู่ใน [`chat_system/graph_service.py`](chat_system/graph_service.py)

---

## ข.8 FAISS Index (RAG Knowledge Base)

```bash
cd /opt/net-chat/rag

# สร้าง index จาก embed_p1 (TH Q+EN A) + embed_p2 (TH Q+TH A) + embed_0 (EN Q+EN A)
python3 build_faiss.py
# → faiss_index.bin (807MB) — 708,562 vectors
# → faiss_meta.pkl (445MB)
```

→ Code จริงอยู่ใน [`rag/build_faiss.py`](rag/build_faiss.py)

### แหล่งข้อมูล
| ไฟล์ | ขนาด | เนื้อหา |
|------|------|--------|
| embed_p1.npz | 676MB | TH Q + EN A (235,998 records) |
| embed_p2.npz | 667MB | TH Q + TH A (236,566 records) |
| embed_0.npz | 668MB | EN Q + EN A (235,998 records) |

---

## ข.9 ตรวจสอบ Services ทั้งหมด

```bash
systemctl status telegraf        # SNMP collector
systemctl status postgresql      # Database
systemctl status grafana-server  # Dashboard
pm2 status                       # Chat API
ps aux | grep rag_service        # RAG
ps aux | grep graph_service      # Graph
curl localhost:11434/api/tags    # Ollama
curl localhost:5002/status       # RAG status
curl localhost:5003/status       # Graph status
curl localhost:5001/health       # Chat API
```
