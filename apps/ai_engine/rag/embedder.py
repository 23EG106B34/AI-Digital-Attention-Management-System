from django.conf import settings

_embedder = None

def get_embedding_model():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer(settings.HF_EMBEDDING_MODEL)
    return _embedder

def embed_text(text: str) -> list[float]:
    try:
        model = get_embedding_model()
        embeddings = model.encode(text)
        return embeddings.tolist()
    except Exception as exc:
        # Callers (retriever / seeding) already treat empty results as
        # "engine unavailable" and return honest insufficient-data answers.
        print(f"[RAG Embedder Warning] embedding unavailable: {exc}")
        raise
