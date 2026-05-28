# Training Guide — Network Chat Model (EdgeAI)

เป้าหมาย: Fine-tune Qwen2.5-1.5B-Instruct บน network Q&A data → export เป็น GGUF → ใช้กับ Ollama บน edge device

---

## Dataset

| ไฟล์ | Pairs | ขนาด | เนื้อหา |
|------|-------|------|---------|
| `data/combined.jsonl.gz` | **235,998** | 94 MB (gz) / 257 MB | รวมทุกแหล่ง (ดีที่สุด) |
| `data/network_qa.jsonl` | 14,532 | ~15 MB | Network Engineering SE เท่านั้น |

**Format:**
```json
{"instruction": "What is OSPF?", "output": "OSPF (Open Shortest Path First) is..."}
```

**แหล่งข้อมูลใน combined.jsonl:**
| แหล่ง | Pairs | หมายเหตุ |
|-------|-------|---------|
| serverfault SE | 56,523 | กรอง network keywords |
| networkengineering SE | 14,532 | network-specific |
| security SE | 9,482 | กรอง network keywords |
| SNMP Special | 3,573 | SNMP/OID/MIB/trap เฉพาะ |
| superuser SE | ~100k+ | general sysadmin |
| askubuntu/unix/electronics | ~50k+ | กรอง network |
| vendor docs (Cisco/Aruba/MikroTik/Fortinet) | ~500 | น้อยเพราะถูก block |
| reddit (networking) | 79 | rate-limit |

---

## Hardware & เวลาที่ใช้

| Hardware | Samples | เวลา | ราคา |
|----------|---------|------|------|
| **Google Colab T4 (แนะนำ)** | 5,000 | ~15 นาที | ฟรี |
| Google Colab T4 | 235,998 (ทั้งหมด) | ~8-10 ชั่วโมง | ฟรี (อาจ timeout) |
| Kaggle P100 | 235,998 | ~6 ชั่วโมง | ฟรี 30h/week |
| RunPod A100 | 235,998 | ~2 ชั่วโมง | ~$1-2 |
| CPU (i7-7567U เครื่องนี้) | 235,998 | **10-15 วัน** | ไม่แนะนำ |

> แนะนำ **Google Colab** สำหรับเริ่มต้น หรือ **Kaggle** สำหรับ dataset ทั้งหมด

---

## Option A: Google Colab (แนะนำ — ฟรี)

### 1. เปิด Colab

ไปที่ https://colab.research.google.com → New notebook → Runtime → Change runtime type → **T4 GPU**

### 2. Clone repo และ setup

```python
# Cell 1: Clone
!git clone https://github.com/Kriangkai0001/Project-2.git
%cd Project-2
```

```python
# Cell 2: ติดตั้ง dependencies
!pip install transformers peft accelerate datasets bitsandbytes -q
```

```python
# Cell 3: Download และ extract training data
!wget https://github.com/Kriangkai0001/Project-2/raw/main/data/combined.jsonl.gz
!gunzip combined.jsonl.gz
!mkdir -p data && mv combined.jsonl data/
!wc -l data/combined.jsonl   # ควรได้ 235998
```

### 3. รัน training (5,000 samples ทดสอบก่อน)

```python
# Cell 4: Train ทดสอบ 5,000 samples (~15 นาที บน T4)
!python scripts/train.py \
  --data data/combined.jsonl \
  --samples 5000 \
  --epochs 2 \
  --batch 8 \
  --output model/lora-adapter
```

**Expected output:**
```
Device: cuda | dtype: torch.float16
trainable params: 6,815,744 || all params: 1,549,614,080 || trainable%: 0.44%
โหลด 5,000 samples จาก data/combined.jsonl
{'loss': 1.8234, 'learning_rate': 0.0001, 'epoch': 0.34}
{'loss': 1.5123, 'learning_rate': 0.00005, 'epoch': 1.00}
...
บันทึก LoRA adapter → model/lora-adapter
```

### 4. Train ทั้งหมด (ถ้าต้องการ — ใช้เวลา 8-10 ชั่วโมง)

```python
# ถ้าใช้ Colab Pro หรือ Kaggle (ไม่ timeout)
!python scripts/train.py \
  --data data/combined.jsonl \
  --epochs 2 \
  --batch 8 \
  --output model/lora-adapter
```

### 5. Export เป็น GGUF สำหรับ Ollama

```python
# Cell 5: Merge LoRA → full model
!python scripts/merge_and_export.py \
  --adapter model/lora-adapter \
  --merged model/merged

# Cell 6: Clone llama.cpp สำหรับ convert
!git clone https://github.com/ggerganov/llama.cpp --depth=1
!pip install -r llama.cpp/requirements.txt -q

# Cell 7: Convert เป็น GGUF Q4_K_M (quantized — เล็กกว่า เร็วกว่า)
!python llama.cpp/convert_hf_to_gguf.py \
  model/merged \
  --outfile model/netchat-q4.gguf \
  --outtype q4_k_m

!ls -lh model/netchat-q4.gguf   # ควรได้ ~1.0 GB
```

### 6. Download GGUF กลับมา

```python
# Cell 8: zip แล้ว download
!zip model/netchat-q4.zip model/netchat-q4.gguf

from google.colab import files
files.download('model/netchat-q4.zip')
```

---

## Option B: Kaggle (ฟรี P100 — 30h/week)

### 1. สร้าง Notebook ใหม่

ไปที่ https://www.kaggle.com → Code → New Notebook → Settings → Accelerator → **GPU P100**

### 2. Setup

```python
!git clone https://github.com/Kriangkai0001/Project-2.git
%cd Project-2
!pip install transformers peft accelerate datasets -q

!wget https://github.com/Kriangkai0001/Project-2/raw/main/data/combined.jsonl.gz
!gunzip combined.jsonl.gz && mkdir -p data && mv combined.jsonl data/
```

### 3. Train ทั้งหมด (Kaggle ไม่ timeout 9 ชั่วโมง)

```python
!python scripts/train.py \
  --data data/combined.jsonl \
  --epochs 3 \
  --batch 8 \
  --output /kaggle/working/lora-adapter
```

### 4. Download output

ไปที่ Output tab → Download `lora-adapter/` folder

---

## Option C: RunPod (เสียเงิน — เร็วที่สุด)

```bash
# เลือก A100 80GB → ~$1.99/hr
# Deploy PyTorch template แล้วรัน:

git clone https://github.com/Kriangkai0001/Project-2.git
cd Project-2
pip install transformers peft accelerate datasets bitsandbytes

wget https://github.com/Kriangkai0001/Project-2/raw/main/data/combined.jsonl.gz
gunzip combined.jsonl.gz && mkdir -p data && mv combined.jsonl data/

python scripts/train.py \
  --data data/combined.jsonl \
  --epochs 3 \
  --batch 16 \
  --output model/lora-adapter

python scripts/merge_and_export.py --adapter model/lora-adapter --merged model/merged --gguf
# ได้ model/netchat-q4.gguf
```

---

## ติดตั้งเข้า Ollama (หลัง download GGUF แล้ว)

```bash
# 1. copy GGUF ไปที่เครื่อง
scp user@server:~/netchat-q4.gguf /opt/net-chat/

# 2. สร้าง Modelfile
cat > /opt/net-chat/Modelfile << 'EOF'
FROM /opt/net-chat/netchat-q4.gguf
PARAMETER temperature 0.7
PARAMETER top_p 0.9
SYSTEM "คุณคือ Network AI Assistant ที่เชี่ยวชาญด้าน Cisco, Aruba, UniFi, MikroTik, HUAWEI, Fortinet, Palo Alto, SNMP (OID/MIB/trap/snmpwalk/ifIndex) ตอบเป็นภาษาไทยหรืออังกฤษตามที่ถาม"
EOF

# 3. โหลดเข้า Ollama
ollama create netchat -f /opt/net-chat/Modelfile

# 4. ทดสอบ
ollama run netchat "SNMP OID คืออะไร"
ollama run netchat "Cisco switch show interface status command"
ollama run netchat "MikroTik firewall drop all traffic ยังไง"
```

### เชื่อมกับ Dashboard

แก้ `/opt/dashboard-grafana/.env`:
```env
OLLAMA_MODEL=netchat
```

แล้ว restart:
```bash
pm2 restart dashboard-api
```

---

## ทดสอบหลัง Train

```python
# ทดสอบ model ใน Python ก่อน export
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel
import torch

base = AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-1.5B-Instruct', torch_dtype=torch.float16, device_map='auto')
tok  = AutoTokenizer.from_pretrained('Qwen/Qwen2.5-1.5B-Instruct')
model = PeftModel.from_pretrained(base, 'model/lora-adapter')

questions = [
    "What is OSPF and how does it work?",
    "SNMP OID คืออะไร",
    "Cisco switch ดู interface ที่ down ยังไง",
]

for q in questions:
    prompt = f"<|im_start|>user\n{q}<|im_end|>\n<|im_start|>assistant\n"
    inputs = tok(prompt, return_tensors='pt').to(model.device)
    out    = model.generate(**inputs, max_new_tokens=200, temperature=0.7)
    print(f"Q: {q}")
    print(f"A: {tok.decode(out[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)}\n")
```

---

## Dependencies (requirements.txt)

```
torch>=2.0
transformers>=4.40
peft>=0.10
accelerate>=0.27
datasets>=2.18
bitsandbytes>=0.43
```

```bash
pip install -r requirements.txt
```

---

## File Structure

```
Project-2/
├── data/
│   └── combined.jsonl.gz   ← training data (235,998 pairs, 94MB)
├── scripts/
│   ├── train.py            ← fine-tune LoRA
│   ├── merge_and_export.py ← merge LoRA + export GGUF
│   └── download_all_vendor_data.py  ← script ที่ใช้รวบรวม data
├── model/                  ← output (สร้างโดย train.py)
│   ├── lora-adapter/
│   ├── merged/
│   └── netchat-q4.gguf
├── TRAINING.md             ← ไฟล์นี้
└── README.md
```

---

## Notes

- **LoRA r=16** → 0.44% parameters เทรน (~6.8M จาก 1.5B) → เร็ว ประหยัด VRAM
- **Q4_K_M** quantization → model 1.5B ขนาด ~1GB บน disk, ใช้ RAM ~1.5GB ขณะรัน
- **combine.jsonl** มีหลาย topic: networking, sysadmin, security, electronics — model จะตอบกว้าง ถ้าต้องการ network-specific กว่า ใช้แค่ `network_qa.jsonl` + `snmp_special.jsonl`
- Vendor data (Cisco/Aruba/Fortinet) น้อยมาก (~500 pairs) เพราะ Reddit/Forum ถูก block ระหว่าง download — ถ้าต้องการเพิ่มให้รัน `scripts/download_all_vendor_data.py` อีกรอบหรือหาจาก HuggingFace เพิ่มเติม
