"""Entry point for python -m go2_gemini. Runs chat (interactive + agentic)."""
import asyncio

from .chat import main

if __name__ == "__main__":
    asyncio.run(main())
