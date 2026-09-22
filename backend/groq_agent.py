import os
import json
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

client = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY"))

async def generate_word_and_category(category: str):
    """
    Generates a unique secret word based on the category using Groq API.
    If category is empty or 'Random', generates both a random category and word.
    """
    if not category or category.strip().lower() == "random":
        prompt = "Generate a random category and a specific secret word for a social deduction game like 'Spyfall'. Respond ONLY with a JSON object in this format: {\"category\": \"Category Name\", \"word\": \"Secret Word\"}."
    else:
        prompt = f"Generate a specific secret word for the category '{category}' for a social deduction game like 'Spyfall'. Respond ONLY with a JSON object in this format: {{\"category\": \"{category}\", \"word\": \"Secret Word\"}}."
    
    try:
        response = await client.chat.completions.create(
            messages=[
                {"role": "user", "content": prompt}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.9,
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content.strip()
        data = json.loads(content)
        return data.get("category", "Random"), data.get("word", "Secret")
    except Exception as e:
        print(f"Groq API Error: {e}")
        # Fallback in case of API failure
        return "Locations", "Bank"
