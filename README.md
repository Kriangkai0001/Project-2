# EdgeAI Network Chatbot — Project 2

ระบบ AI ตรวจจับ network anomaly และ chatbot สำหรับถามตอบข้อมูล network แบบระบบปิด (ไม่ใช้ API ภายนอก)

---

## ภาพรวม

```
อุปกรณ์ Network (SNMP v3)
  → Telegraf (ทุก 5 นาที)
  → PostgreSQL (edgedb)
  ├─→ ML Pipeline → anomaly detection → Grafana
  └─→ Chat System → ถามตอบภาษาธรรมชาติ → Grafana
```

ประกอบด้วย 2 ส่วนหลัก:
- **ML Pipeline** — IsolationForest + ARIMA ตรวจจับ anomaly และจำแนก scenario
- **Chat System** — RAG + qwen2.5:3b (Ollama) ตอบคำถาม network จาก DB + knowledge base

---

## เอกสารหลัก

| ไฟล์ | เนื้อหา |
|------|--------|
| [PROJECT_STATE.md](PROJECT_STATE.md) | ภาพรวมระบบ, flow, สถานะปัจจุบัน, ผลทดสอบ |
| [REFERENCE.md](REFERENCE.md) | DB schema ทุก table, ports, env vars, hardware spec |

## ผนวก

| ผนวก | ไฟล์ | เนื้อหา |
|------|------|--------|
| ก | [APPENDIX_A.md](APPENDIX_A.md) | โทโพโลยี + ติดตั้ง Linux + Config SW/Router (IP, SNMP, Syslog) |
| ข | [APPENDIX_B.md](APPENDIX_B.md) | ติดตั้ง Services ทั้งหมด: PostgreSQL, Telegraf, Grafana, venv ML, Node.js, Ollama, RAG |
| ค | [APPENDIX_C.md](APPENDIX_C.md) | Config และ Code ทั้งหมด: SNMP, DB schema, ML Pipeline, Chat System, RAG |
| ง | [APPENDIX_D.md](APPENDIX_D.md) | ผลทดสอบ 100 คำถาม (97/100) — ตารางครบทุกข้อ |
| จ | [APPENDIX_E.md](APPENDIX_E.md) | เอกสารอ้างอิง + links ไปยัง code/config แต่ละส่วน |

---

## Source Code

| โฟลเดอร์ | ไฟล์ | หน้าที่ |
|---------|------|--------|
| `ml_pipeline/` | export.py | ดึง features จาก DB |
| | predict.py | IsolationForest → anomaly + scenario |
| | predict_arima.py | ARIMA forecast + gap detection |
| | insert_result.py / insert_arima.py | บันทึกผลกลับ DB |
| | train_save.py | retrain IsolationForest |
| | train_arima_threshold.py | คำนวณ threshold ใหม่ |
| | train_scenario_classifier.py | retrain scenario classifier (SL) |
| `chat_system/` | server.js | Chat API หลัก (routing, SQL, session) |
| | config.js | SQL/Analyst prompts, quick prompts |
| | graph_service.py | Knowledge Graph จาก DB |
| | scenario_playbook.json | 10 scenarios + คำแนะนำ |
| | prompts_100.json | ชุดทดสอบ 100 คำถาม |
| `rag/` | rag_service.py | FAISS query service |
| | build_faiss.py | สร้าง vector index |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Collector | Telegraf (SNMP v3, Syslog UDP) |
| Database | PostgreSQL 16 (edgedb) |
| Dashboard | Grafana 8888 |
| ML | scikit-learn (IsolationForest), statsmodels (ARIMA), Python 3.12 |
| LLM | Ollama — qwen2.5:3b |
| Chat API | Node.js + PM2 |
| RAG | FAISS (708,562 vectors EN+TH+TH), sentence-transformers |
| Knowledge Graph | Python FastAPI |

---

## Services

| Service | Port |
|---------|------|
| Grafana | 8888 |
| Chat API | 5001 |
| RAG | 5002 |
| Graph | 5003 |
| PostgreSQL | 5432 |
| Ollama | 11434 |

---

## Hardware

- **Server:** Intel i7-7567U (2c/4t), RAM 7.6GB, Ubuntu 24.04
- **Monitor:** Cisco 2960 L2 SW + Router Project

---

## ผลทดสอบ 100 คำถาม

| รอบ | ✓ | ✗ | เฉลี่ย |
|-----|---|---|--------|
| Baseline (Groq+Qwen) | 97 | 0 | 78s |
| Round 1 (qwen local) | 93 | 7 | ~100s |
| Round 2 (ปรับ prompt) | 97 | 3 | 77s |
