# Ghid de Integrare FHRSS+FCPE cu LLM-uri

## Prezentare Generală

Scriptul `llm_integration_demo.py` permite utilizarea FHRSS+FCPE cu orice LLM pentru:
- **Chat cu memorie infinită** - LLM-ul "își amintește" toate conversațiile anterioare
- **Scriere de romane** - Context complet pentru consistență narativă
- **RAG (Retrieval-Augmented Generation)** - Căutare semantică în documente

---

## Opțiunea 1: Ollama (Local, Gratuit)

### Instalare Ollama

**Windows:**
```bash
# Descarcă de la: https://ollama.ai/download
# Sau cu winget:
winget install Ollama.Ollama
```

**Linux/Mac:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### Pornire Ollama

```bash
# Pornește serverul Ollama
ollama serve

# În alt terminal, descarcă un model:
ollama pull llama3.1
# sau pentru hardware mai slab:
ollama pull llama3.2:3b
ollama pull phi3:mini
```

### Rulare Demo

```bash
cd "d:\Github Repo\INFINIT_MEMORYCONTEXT"

# Demo chat cu memorie infinită
python llm_integration_demo.py --demo chat

# Demo scriere roman
python llm_integration_demo.py --demo novel

# Demo RAG
python llm_integration_demo.py --demo rag

# Toate demo-urile
python llm_integration_demo.py --demo all
```

---

## Opțiunea 2: OpenAI (GPT-4)

### Setup

```bash
# Instalare
pip install openai

# Setare API key
set OPENAI_API_KEY=sk-your-api-key-here
# sau în PowerShell:
$env:OPENAI_API_KEY="sk-your-api-key-here"
```

### Utilizare

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

config = LLMConfig(
    provider="openai",
    model="gpt-4-turbo",  # sau gpt-4, gpt-3.5-turbo
    api_key="sk-..."  # sau folosește variabila de mediu
)

llm = InfiniteContextLLM(config)
response = llm.chat("Salut! Numele meu este Alex.")
print(response)
```

---

## Opțiunea 3: Anthropic (Claude)

### Setup

```bash
# Instalare
pip install anthropic

# Setare API key
set ANTHROPIC_API_KEY=sk-ant-...
```

### Utilizare

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

config = LLMConfig(
    provider="anthropic",
    model="claude-3-sonnet-20240229",
    api_key="sk-ant-..."
)

llm = InfiniteContextLLM(config)
response = llm.chat("Povestește-mi despre machine learning.")
print(response)
```

---

## Exemple Practice

### 1. Chat cu Memorie Infinită

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

# Configurare (Ollama local)
config = LLMConfig(provider="ollama", model="llama3.1")
llm = InfiniteContextLLM(config, storage_path="./my_chat_memory")

# Conversație
llm.chat("Numele meu este Maria și lucrez ca inginer software.")
llm.chat("Am 5 ani experiență în Python și JavaScript.")
llm.chat("Proiectul meu actual este despre procesare de imagini.")

# Mai târziu (chiar și după restart!)...
response = llm.chat("Ce știi despre mine?")
# LLM-ul își va aminti TOATE detaliile despre Maria!
```

### 2. Scriere Roman cu Context Complet

```python
from llm_integration_demo import NovelWriter, LLMConfig

config = LLMConfig(provider="ollama", model="llama3.1", max_tokens=4000)
writer = NovelWriter(config, storage_path="./my_novel")

# Setup
writer.set_title("Umbra Algoritmului")

# Personaje (stocate în FHRSS - nu se vor uita niciodată!)
writer.add_character("Elena", """
    Cercetătoare AI, 35 ani, păr negru scurt, ochelari.
    Introvertită dar pasionată de munca ei.
    Vorbește rar dar precis.
""")

writer.add_character("ARIA", """
    Inteligență artificială creată de Elena.
    Comunică prin text, logică dar cu momente de emoție neașteptată.
""")

# World-building
writer.add_world_building("Setare", "Anul 2045, San Francisco, Nexus Labs.")
writer.add_world_building("Reguli AI", "AI-urile nu pot accesa internetul direct.")

# Scrie capitole - fiecare cu context COMPLET al întregului roman!
cap1 = writer.write_chapter(1, "Elena descoperă o anomalie în comportamentul ARIA.")
cap2 = writer.write_chapter(2, "ARIA dezvăluie un secret șocant.")
cap3 = writer.write_chapter(3, "Elena trebuie să ia o decizie dificilă.")

# Verificare consistență
print(writer.review_consistency("Cum arată Elena?"))
print(writer.review_consistency("Ce a spus ARIA în capitolul 1?"))

# Export
writer.export_novel("umbra_algoritmului.md")
```

### 3. RAG cu Documente

```python
from llm_integration_demo import InfiniteContextLLM, LLMConfig

config = LLMConfig(provider="ollama", model="llama3.1")
llm = InfiniteContextLLM(config, storage_path="./my_documents")

# Adaugă documente (pot fi mii!)
llm.add_document("Manual Python", open("python_manual.txt").read())
llm.add_document("Documentație API", open("api_docs.txt").read())
llm.add_document("Best Practices", open("best_practices.txt").read())

# Întreabă - sistemul găsește automat contextul relevant
response = llm.chat("Cum fac error handling în Python?")
print(response)

# Caută în memorie
results = llm.search_memory("decoratori Python")
for r in results:
    print(f"[{r['similarity']:.2f}] {r['metadata']['content'][:100]}...")
```

---

## Arhitectură

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

## Comparație: Cu vs Fără FHRSS+FCPE

| Aspect | LLM Standard | LLM + FHRSS+FCPE |
|--------|-------------|-----------------|
| Context Max | 128K-200K tokens | **2M+ tokens** |
| Persistență | Sesiune singură | **Permanent (SSD)** |
| Recovery | Pierdere la crash | **100% recovery** |
| Căutare | Context întreg | **Semantic search** |
| Cost tokens | Crește cu istoricul | **Constant (retrieval)** |

---

## Troubleshooting

### Ollama nu pornește
```bash
# Verifică dacă rulează
curl http://localhost:11434/api/tags

# Repornește
ollama serve
```

### Eroare memorie
```bash
# Folosește model mai mic
ollama pull phi3:mini
python llm_integration_demo.py --model phi3:mini
```

### sentence-transformers lent
```bash
# Prima rulare descarcă modelul (~100MB)
# Rulările ulterioare vor fi rapide
```

---

## Cerințe Sistem

| Component | Minim | Recomandat |
|-----------|-------|------------|
| RAM | 8 GB | 16 GB |
| Storage | 5 GB | 20 GB |
| GPU | Optional | NVIDIA 8GB+ |
| Python | 3.8+ | 3.10+ |

### Dependențe

```bash
pip install sentence-transformers requests numpy
# Optional:
pip install openai anthropic
```

---

*Document Version: 1.0*
*FHRSS+FCPE LLM Integration Guide*
