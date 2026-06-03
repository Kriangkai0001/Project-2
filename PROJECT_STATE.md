# EdgeAI Network Chatbot — สถานะโปรเจ็คปัจจุบัน
> อัพเดต: 2026-06-03 | Server: 10.252.209.28

---

## ภาพรวมระบบ

โปรเจ็คแบ่งเป็น 2 ส่วนหลัก:
1. **ML Pipeline** — ตรวจจับ network anomaly อัตโนมัติ
2. **Chat System** — ถามตอบข้อมูล network ด้วยภาษาธรรมชาติ ระบบปิด ไม่ใช้ API ภายนอก

---

## ส่วนที่ 1 — ML Pipeline

### Flow
```
Telegraf (SNMP ทุก 5 นาที)
  → PostgreSQL edgedb
  → export.py        — ดึงข้อมูลจาก DB เตรียม features
  → predict.py       — IsolationForest → anomaly_label + scenario_name
  → predict_arima.py — ARIMA Forecast → anomaly + gap detection
  → insert_result.py — บันทึกผล IsolationForest กลับ DB
  → insert_arima.py  — บันทึกผล ARIMA กลับ DB
  → Grafana          — แสดงผล dashboard
```

### Cron Jobs
```bash
# Inference ทุก 15 นาที
*/15 * * * * export.py && predict.py && insert_result.py && predict_arima.py && insert_arima.py

# Retrain ทุกอาทิตย์ (อาทิตย์ ตี 1)
0 1 * * 0  train_save.py && train_arima_threshold.py && train_scenario_classifier.py
```

### ไฟล์ ML (`/opt/net-model/`)
| ไฟล์ | หน้าที่ |
|------|---------|
| `export.py` | ดึงข้อมูลจาก edgedb → CSV features |
| `predict.py` | โหลด model.pkl → predict anomaly + scenario |
| `predict_arima.py` | ARIMA forecast → เปรียบ actual vs predicted |
| `insert_result.py` | insert ผล IsolationForest → ml_isolation_forest |
| `insert_arima.py` | insert ผล ARIMA → ml_arima |
| `train_save.py` | retrain IsolationForest + บันทึก model.pkl |
| `train_arima_threshold.py` | คำนวณ threshold ใหม่ → arima_thresholds.json |
| `train_scenario_classifier.py` | retrain scenario classifier (SL 80/20) |
| `train_arima.py` | เทรน ARIMA model |
| `train_interface.py` | เทรน interface model |

### Model Files (`/opt/net-model/models/`)
| ไฟล์ | ขนาด | อุปกรณ์ |
|------|------|---------|
| `PR-test-sw_netsec_local_iso_model.pkl` | 642KB | SW Cisco 2960 |
| `PR-test-sw_netsec_local_iso_scaler.pkl` | 801B | SW Cisco 2960 |
| `RouterProject_mynetwork_com_iso_model.pkl` | 797KB | Router Project |
| `RouterProject_mynetwork_com_iso_scaler.pkl` | 801B | Router Project |
| `scenario_classifier.pkl` | 625KB | ทุกอุปกรณ์ |
| `arima_thresholds.json` | threshold mem_used=10338 |

### Scenario Names (IsolationForest)
| scenario_name | จำนวนใน DB | ความหมาย |
|---------------|-----------|---------|
| high_memory | 4,919 | RAM ใช้เกิน threshold |
| traffic_flood | 1,615 | in_bps/ifSpeed สูงเกิน |
| traffic_spike | 693 | traffic พุ่งสูงชั่วคราว |
| traffic_high | 68 | traffic สูงต่อเนื่อง |
| port_error | 38 | in_err_rate > 0 |
| link_congestion | 34 | congestion บน link |
| error_flood | 24 | error rate สูง |
| elevated_cpu | 19 | CPU เพิ่มขึ้นต่อเนื่อง |
| unknown_anomaly | 12 | ตรวจจับได้แต่จำแนกไม่ได้ |
| high_cpu | 1 | CPU เกิน 80% |
| (ว่าง) | 37,526 | normal (ไม่มี anomaly) |

### ARIMA Features
| feature | ทั้งหมด | anomaly count |
|---------|---------|--------------|
| cpu_5s | 44,733 | 66 |
| mem_used | 44,733 | 487 |
| in_bps | 44,733 | 293 |
| out_bps | 44,733 | 290 |
| in_err_rate | 44,733 | 270 |
| gap | 17 | 17 (SW ดับ) |

---

## ส่วนที่ 2 — Chat System

### Services ที่รันอยู่
| Service | ไฟล์ | Port | รันด้วย |
|---------|------|------|---------|
| Chat API | `/opt/dashboard-grafana/server.js` | 5001 | PM2 (dashboard-api) |
| RAG Service | `/opt/net-chat/rag/rag_service.py` | 5002 | python3 background |
| Graph Service | `/opt/dashboard-grafana/graph_service.py` | 5003 | python3 background |

### Chat Flow
```
User (Grafana panel)
  → server.js :5001
       ├─ Graph service :5003   → topology / "มีระบบ/support" + protocol keyword
       ├─ RAG (FAISS) :5002     → "คืออะไร / explain / what is"
       ├─ SQL Template (12 แบบ) → คำถาม DB ที่รู้จัก (ไม่ผ่าน qwen SQL gen)
       └─ qwen2.5:1.5b (Ollama) → สร้าง SQL / วิเคราะห์ผล / ตอบ knowledge
```

### SQL Templates (12 แบบ ใน server.js)
| pattern | SQL ที่ใช้ |
|---------|-----------|
| vlan interface | interface WHERE ifName ILIKE '%vlan%' |
| uptime เปรียบ | snmp DISTINCT ON hostname ORDER BY time DESC |
| high cpu anomaly | ml_isolation_forest WHERE scenario_name ILIKE '%cpu%' |
| traffic anomaly ล่าสุด | ml_isolation_forest WHERE in_bps/out_bps > 0 |
| arima traffic out | ml_arima WHERE feature='out_bps' |
| arima traffic in | ml_arima WHERE feature='in_bps' |
| login ผิดปกติ / brute force | syslog GROUP BY source |
| cpu ล่าสุด | snmp DISTINCT ON hostname |
| memory ล่าสุด | snmp DISTINCT ON hostname |
| interface สถานะ | interface DISTINCT ON hostname,ifName |
| anomaly ล่าสุด | ml_isolation_forest DISTINCT ON hostname |

### RAG Knowledge Base
| แหล่งข้อมูล | ภาษา | จำนวน |
|------------|------|-------|
| Stack Exchange (serverfault, security, networkengineering, SNMP) | English | 84,199 pairs |
| combined_th.jsonl (แปล instruction→Thai) | Thai | 235,998 records |
| combined_th_full.jsonl (แปล output→Thai) | Thai | 236,568 pairs |
| scenario_playbook.json | Thai | 10 scenarios |

**FAISS Index:** 550,774 vectors (faiss_index.bin 807MB + faiss_meta.pkl 445MB)
**Embed model:** all-MiniLM-L6-v2

### Session Management
- แยก session ต่อ tab (sessionId จาก frontend)
- history 8 คู่ ต่อ session
- TTL 30 นาที (in-memory)
- refresh หน้า = session ใหม่

### Knowledge Graph (graph_service.py)
- rebuild ทุก 5 นาที จาก DB
- tables ที่สแกน: snmp, interface, syslog, ml_isolation_forest, ml_arima
- expose `/graph/summary/all`, `/graph/{device}`, `/graph/{device}/{protocol}`
- protocols ที่มีข้อมูลจริง: snmp, interface, syslog, anomaly_isolation, anomaly_arima

---

## Database (`edgedb` PostgreSQL)

### Tables หลักที่ใช้งาน
| Table | คอลัมน์หลัก | ใครเขียน | ข้อมูล |
|-------|------------|---------|-------|
| `snmp` | time, hostname, cpu_5s, mem_free, mem_used, uptime | Telegraf | 44,959 rows (Feb–Jun 2026) |
| `interface` | time, hostname, ifName, ifOperStatus, ifHighSpeed, ifSpeed, vlan_id | Telegraf | 1,653,116 rows |
| `syslog` | time, hostname, message, source, severity | Telegraf | 5,562 rows |
| `ml_isolation_forest` | time, hostname, anomaly, anomaly_label, scenario_name, cpu_5s, mem_used, in_bps, out_bps | predict.py | 44,949 rows |
| `ml_arima` | time, hostname, feature, actual, predicted, threshold, anomaly, scenario_name | predict_arima.py | 223,682 rows |
| `monitored_devices` | hostname, device_type, ip, description | manual | 2 rows |

### Monitored Devices
| hostname | device_type | ip | description |
|----------|------------|-----|-------------|
| PR-test-sw.netsec.local | switch | 192.168.204.88 | Cisco 2960 L2 SW |
| RouterProject.mynetwork.com | router | 192.168.99.1 | Router Project |

### Tables อื่นที่มีใน DB (ไม่ได้ใช้หลัก)
`cpu`, `devices`, `disk`, `diskio`, `interfaces`, `kernel`, `measure_server_compute`, `measure_switch_traffic`, `mem`, `ml_labels`, `processes`, `raw_telemetry_landing`, `snmp_hourly`, `swap`, `syslogs`, `syslogs_buffer`, `system`

---

## ไฟล์สำคัญอื่นๆ

### `/opt/dashboard-grafana/`
| ไฟล์ | หน้าที่ |
|------|---------|
| `server.js` | Chat API หลัก (50KB) |
| `config.js` | SQL_SYSTEM_PROMPT, ANALYST_SYSTEM_PROMPT, QUICK_PROMPTS |
| `graph_service.py` | Knowledge Graph builder |
| `rag_service.py` | RAG query service (FAISS) |
| `scenario_playbook.json` | คำแนะนำ 10 scenarios |
| `prompts_100.json` | ชุดทดสอบ 100 คำถาม |

### `/opt/net-chat/rag/`
| ไฟล์ | ขนาด | หน้าที่ |
|------|------|---------|
| `faiss_index.bin` | 807MB | FAISS vector index |
| `faiss_meta.pkl` | 445MB | metadata (Q+A) |
| `combined_th_full.jsonl` | 809MB | Thai training data |
| `embed_p1.npz` | 676MB | English embeddings |
| `embed_p2.npz` | 667MB | Thai embeddings |

---

## LLM ที่ใช้

| model | ใช้ทำอะไร | รันที่ |
|-------|---------|-------|
| `qwen2.5:1.5b` | สร้าง SQL, วิเคราะห์ผล DB, ตอบ knowledge | Ollama (local) |
| `qwen2.5:3b` | ติดตั้งไว้ (สำรอง) | Ollama (local) |
| `llama3.1:latest` | ติดตั้งไว้ (สำรอง) | Ollama (local) |

---

## ผลทดสอบ 100 คำถาม

| รอบ | ✓ | ✗ | เฉลี่ย | หมายเหตุ |
|-----|---|---|--------|---------|
| Groq+Qwen (ก่อน RAG Thai) | 97 | 0 | 78s | ดีที่สุด |
| หลัง Graph+Analyst | 93 | 7 | 100s | Graph routing พัง |

---

## Hardware
- **Server (10.252.209.28):** Intel i7-7567U (2c/4t), RAM 7.6GB, Ubuntu 24.04
- **Collector:** Telegraf → SNMP ทุก 5 นาที → PostgreSQL edgedb
- **Grafana:** port 3000 (แสดง dashboard + chat panel)
