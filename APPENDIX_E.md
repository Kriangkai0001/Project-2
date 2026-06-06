# ผนวก จ — เอกสารอ้างอิง

---

## จ.1 เอกสารและงานวิจัยที่เกี่ยวข้อง

*(รอเพิ่มข้อมูลจากอาจารย์ที่ปรึกษา)*

---

## จ.2 แหล่งข้อมูลที่ใช้ในระบบ

### Training Data (RAG Knowledge Base)
| แหล่งข้อมูล | URL | จำนวน |
|------------|-----|-------|
| Stack Exchange — Server Fault | archive.org/details/stackexchange | ~40,000 pairs |
| Stack Exchange — Network Engineering | archive.org/details/stackexchange | ~20,000 pairs |
| Stack Exchange — Security | archive.org/details/stackexchange | ~15,000 pairs |
| Stack Exchange — SNMP topics | archive.org/details/stackexchange | ~9,000 pairs |
| combined.jsonl (ฝากไว้) | https://files.catbox.moe/bexvgs.gz | 235,998 records (94MB gz) |

### Tools และ Libraries
| Tool | Version | Link |
|------|---------|------|
| scikit-learn | 1.8.0 | https://scikit-learn.org |
| statsmodels | 0.14.6 | https://www.statsmodels.org |
| FAISS | faiss-cpu | https://github.com/facebookresearch/faiss |
| sentence-transformers | latest | https://www.sbert.net |
| Telegraf | latest | https://www.influxdata.com/telegraf |
| Ollama | latest | https://ollama.com |
| qwen2.5:3b | 3B | https://ollama.com/library/qwen2.5 |
| all-MiniLM-L6-v2 | — | https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 |

---

## จ.3 Link ไปยัง Code และ Config

| ส่วน | ไฟล์ | Link |
|------|------|------|
| ML — ดึงข้อมูล | export.py | [ml_pipeline/export.py](ml_pipeline/export.py) |
| ML — IsolationForest | predict.py | [ml_pipeline/predict.py](ml_pipeline/predict.py) |
| ML — ARIMA | predict_arima.py | [ml_pipeline/predict_arima.py](ml_pipeline/predict_arima.py) |
| ML — บันทึกผล IF | insert_result.py | [ml_pipeline/insert_result.py](ml_pipeline/insert_result.py) |
| ML — บันทึกผล ARIMA | insert_arima.py | [ml_pipeline/insert_arima.py](ml_pipeline/insert_arima.py) |
| ML — Retrain IF | train_save.py | [ml_pipeline/train_save.py](ml_pipeline/train_save.py) |
| ML — ARIMA Threshold | train_arima_threshold.py | [ml_pipeline/train_arima_threshold.py](ml_pipeline/train_arima_threshold.py) |
| ML — Scenario Classifier | train_scenario_classifier.py | [ml_pipeline/train_scenario_classifier.py](ml_pipeline/train_scenario_classifier.py) |
| Chat — API หลัก | server.js | [chat_system/server.js](chat_system/server.js) |
| Chat — Prompts | config.js | [chat_system/config.js](chat_system/config.js) |
| Chat — Knowledge Graph | graph_service.py | [chat_system/graph_service.py](chat_system/graph_service.py) |
| Chat — Scenarios | scenario_playbook.json | [chat_system/scenario_playbook.json](chat_system/scenario_playbook.json) |
| Chat — Test Questions | prompts_100.json | [chat_system/prompts_100.json](chat_system/prompts_100.json) |
| RAG — Query Service | rag_service.py | [rag/rag_service.py](rag/rag_service.py) |
| RAG — Build Index | build_faiss.py | [rag/build_faiss.py](rag/build_faiss.py) |
