import os
from dotenv import load_dotenv
load_dotenv()

PROVIDER = os.getenv("LLM_PROVIDER", "groq")


def generate(prompt: str, system: str = "") -> str:
    if PROVIDER == "groq":
        from groq import Groq
        client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        r = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        return r.choices[0].message.content

    if PROVIDER == "claude":
        import anthropic
        client = anthropic.Anthropic()
        r = client.messages.create(
            model=os.getenv("LLM_MODEL", "claude-haiku-5-5"),
            max_tokens=1000,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return r.content[0].text

    raise ValueError(f"Unknown provider {PROVIDER}")


if __name__ == "__main__":
    print(generate("Say hello in one short sentence."))