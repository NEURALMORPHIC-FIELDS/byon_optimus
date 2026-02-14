# FHRSS+FCPE LLM Integration Guide

## Overview

The `llm_integration_demo.py` script enables using FHRSS+FCPE with any LLM for:
- **Chat with infinite memory** - The LLM "remembers" all previous conversations
- **Novel writing** - Full context for narrative consistency
- **RAG (Retrieval-Augmented Generation)** - Semantic search in documents

---

## Option 1: Ollama (Local, Free)

### Install Ollama

**Windows:**
```bash
# Download from: https://ollama.ai/download
# Or with winget:
winget install Ollama.Ollama
```

**Linux/Mac:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Start Ollama

```bash
# Start the Ollama server
ollama serve

# In another terminal, download a model:
ollama pull llama3.1
# or for weaker hardware:
ollama pull llama3.2:3b
ollama pull phi3:mini
```

### Run Demo

```bash
cd "d:\Github Repo\INFINIT_MEMORYCONTEXT"

# Demo chat with infinite memory
python llm_integration_demo.py --demo chat

# Demo novel writing
python llm_integration_demo.py --demo novel

# Demo RAG
python llm_integration_demo.py --demo rag

# All demos
python llm_integration_demo.py --demo all
```

---

## Option 2: OpenAI (GPT-4)

### Setup

```bash
# Install
pip install openai

# Set API key
set OPENAI_API_KEY=sk-your-api-key-here
# or in PowerShell:
$env:OPENAI_API_KEY="sk-your-api-key-here"
```

### Usage

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

config = LLMConfig(
    provider="openai",
    model="gpt-4-turbo",  # or gpt-4, gpt-3.5-turbo
    api_key="sk-..."  # or use environment variable
)

llm = InfiniteContextLLM(config)
response = llm.chat("Hello! My name is Alex.")
print(response)
```

---

## Option 3: Anthropic (Claude)

### Setup

```bash
# Install
pip install anthropic

# Set API key
set ANTHROPIC_API_KEY=sk-ant-...
```

### Usage

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

config = LLMConfig(
    provider="anthropic",
    model="claude-3-sonnet-20240229",
    api_key="sk-ant-..."
)

llm = InfiniteContextLLM(config)
response = llm.chat("Tell me about machine learning.")
print(response)
```

---

## Practical Examples

### 1. Chat with Infinite Memory

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

# Configuration (local Ollama)
config = LLMConfig(provider="ollama", model="llama3.1")
llm = InfiniteContextLLM(config, storage_path="./my_chat_memory")

# Conversation
llm.chat("My name is Maria and I work as a software engineer.")
llm.chat("I have 5 years of experience in Python and JavaScript.")
llm.chat("My current project is about image processing.")

# Later (even after restart!)...
response = llm.chat("What do you know about me?")
# The LLM will remember ALL details about Maria!
```

### 2. Novel Writing with Full Context

```python
from llm_integration_demo import NovelWriter, LLMConfig

config = LLMConfig(provider="ollama", model="llama3.1", max_tokens=4000)
writer = NovelWriter(config, storage_path="./my_novel")

# Setup
writer.set_title("The Shadow of the Algorithm")

# Characters (stored in FHRSS - will never be forgotten!)
writer.add_character("Elena", """
    AI researcher, 35 years old, short black hair, glasses.
    Introverted but passionate about her work.
    Speaks rarely but precisely.
""")

writer.add_character("ARIA", """
    Artificial intelligence created by Elena.
    Communicates through text, logical but with moments of unexpected emotion.
""")

# World-building
writer.add_world_building("Setting", "Year 2045, San Francisco, Nexus Labs.")
writer.add_world_building("AI Rules", "AIs cannot access the internet directly.")

# Write chapters - each with FULL context of the entire novel!
ch1 = writer.write_chapter(1, "Elena discovers an anomaly in ARIA's behavior.")
ch2 = writer.write_chapter(2, "ARIA reveals a shocking secret.")
ch3 = writer.write_chapter(3, "Elena must make a difficult decision.")

# Consistency check
print(writer.review_consistency("What does Elena look like?"))
print(writer.review_consistency("What did ARIA say in chapter 1?"))

# Export
writer.export_novel("shadow_of_algorithm.md")
```

### 3. RAG with Documents

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

config = LLMConfig(provider="ollama", model="llama3.1")
llm = InfiniteContextLLM(config, storage_path="./my_documents")

# Add documents (can be thousands!)
llm.add_document("Python Manual", open("python_manual.txt").read())
llm.add_document("API Documentation", open("api_docs.txt").read())
llm.add_document("Best Practices", open("best_practices.txt").read())

# Ask - the system automatically finds relevant context
response = llm.chat("How do I do error handling in Python?")
print(response)

# Search in memory
results = llm.search_memory("Python decorators")
for r in results:
    print(f"[{r['similarity']:.2f}] {r['metadata']['content'][:100]}...")
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INPUT                               │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 InfiniteContextLLM                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Embed user message (sentence-transformers)       │  │
│  │  2. Store in FHRSS+FCPE memory                       │  │
│  │  3. Retrieve relevant context (semantic search)      │  │
│  │  4. Build prompt with context                        │  │
│  │  5. Send to LLM                                      │  │
│  │  6. Store response in memory                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
       ┌──────────┐    ┌──────────┐    ┌──────────┐
       │  Ollama  │    │  OpenAI  │    │ Anthropic│
       │ (Local)  │    │ (GPT-4)  │    │ (Claude) │
       └──────────┘    └──────────┘    └──────────┘
```

---

## Comparison: With vs Without FHRSS+FCPE

| Aspect | Standard LLM | LLM + FHRSS+FCPE |
|--------|-------------|-----------------|
| Max Context | 128K-200K tokens | **2M+ tokens** |
| Persistence | Single session | **Permanent (SSD)** |
| Recovery | Lost on crash | **100% recovery** |
| Search | Entire context | **Semantic search** |
| Token Cost | Grows with history | **Constant (retrieval)** |

---

## Troubleshooting

### Ollama does not start
```bash
# Check if running
curl http://localhost:11434/api/tags

# Restart
ollama serve
```

### Memory error
```bash
# Use a smaller model
ollama pull phi3:mini
python llm_integration_demo.py --model phi3:mini
```

### sentence-transformers slow
```bash
# First run downloads the model (~100MB)
# Subsequent runs will be fast
```

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|------------|
| RAM | 8 GB | 16 GB |
| Storage | 5 GB | 20 GB |
| GPU | Optional | NVIDIA 8GB+ |
| Python | 3.8+ | 3.10+ |

### Dependencies

```bash
pip install sentence-transformers requests numpy
# Optional:
pip install openai anthropic
```

---

*Document Version: 1.0*
*FHRSS+FCPE LLM Integration Guide*
