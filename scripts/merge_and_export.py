"""
Merge LoRA adapter กับ base model แล้ว convert เป็น GGUF สำหรับ Ollama

ใช้หลังจาก train.py เสร็จแล้ว

ขั้นตอน:
  1. python merge_and_export.py          # merge → model/merged/
  2. python merge_and_export.py --gguf   # merge + convert GGUF → model/netchat.gguf
"""
import os
import argparse
import subprocess
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

BASE_MODEL   = 'Qwen/Qwen2.5-1.5B-Instruct'
LORA_ADAPTER = 'model/lora-adapter'
MERGED_DIR   = 'model/merged'
GGUF_PATH    = 'model/netchat-q4.gguf'

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--base',    default=BASE_MODEL,   help='base model name')
    p.add_argument('--adapter', default=LORA_ADAPTER, help='LoRA adapter path')
    p.add_argument('--merged',  default=MERGED_DIR,   help='merged model output')
    p.add_argument('--gguf',    action='store_true',  help='also convert to GGUF')
    p.add_argument('--llama-cpp', default='llama.cpp', help='path to llama.cpp repo')
    return p.parse_args()

def merge(args):
    print(f"โหลด base model: {args.base}")
    tokenizer = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=torch.float16,
        trust_remote_code=True,
        device_map='cpu'
    )

    print(f"โหลด LoRA adapter: {args.adapter}")
    model = PeftModel.from_pretrained(model, args.adapter)

    print("Merging LoRA weights...")
    model = model.merge_and_unload()

    os.makedirs(args.merged, exist_ok=True)
    model.save_pretrained(args.merged, safe_serialization=True)
    tokenizer.save_pretrained(args.merged)
    print(f"Merged model → {args.merged}")
    return args.merged

def convert_gguf(merged_dir, llama_cpp_path, gguf_path):
    convert_script = os.path.join(llama_cpp_path, 'convert_hf_to_gguf.py')
    if not os.path.exists(convert_script):
        print(f"ไม่เจอ {convert_script}")
        print("clone llama.cpp ก่อน:")
        print("  git clone https://github.com/ggerganov/llama.cpp")
        print("  cd llama.cpp && pip install -r requirements.txt")
        return

    os.makedirs(os.path.dirname(gguf_path) or '.', exist_ok=True)
    cmd = [
        'python', convert_script,
        merged_dir,
        '--outfile', gguf_path,
        '--outtype', 'q4_k_m'
    ]
    print(f"Converting: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    print(f"GGUF saved → {gguf_path}")

    modelfile = gguf_path.replace('.gguf', '.Modelfile')
    with open(modelfile, 'w') as f:
        f.write(f'FROM {os.path.abspath(gguf_path)}\n')
        f.write('PARAMETER temperature 0.7\n')
        f.write('PARAMETER top_p 0.9\n')
        f.write('SYSTEM "คุณคือ Network AI Assistant ที่เชี่ยวชาญด้าน Cisco, Aruba, MikroTik, SNMP, BGP, OSPF และ network troubleshooting ตอบเป็นภาษาไทยหรืออังกฤษตามที่ถาม"\n')
    print(f"Modelfile → {modelfile}")
    print(f"\nโหลดเข้า Ollama:")
    print(f"  ollama create netchat -f {modelfile}")
    print(f"  ollama run netchat 'SNMP OID คืออะไร'")

def main():
    args = parse_args()
    merged = merge(args)
    if args.gguf:
        convert_gguf(merged, args.llama_cpp, GGUF_PATH)

if __name__ == '__main__':
    main()
