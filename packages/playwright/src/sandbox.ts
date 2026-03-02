"""
Sandboxed Playwright worker for SecuredClaudeBot.

This module wraps the Playwright worker in a Docker container for
secure isolation from the host system.
"""

import json
import subprocess
import uuid
from typing import Optional
from dataclasses import dataclass


@dataclass
class SandboxConfig:
    """Configuration for the sandbox."""
    image: str = "mcr.microsoft.com/playwright:v1.40.0"
    memory: str = "1g"
    cpus: float = 1.0
    pids_limit: int = 100
    network: bool = False  # Set to True to allow network


class SandboxedPlaywrightWorker:
    """
    Playwright worker that runs in an isolated Docker container.
    
    This provides:
    - Network isolation (optional)
    - Memory limits
    - CPU limits
    - Process limits
    - Ephemeral execution (container destroyed after)
    """
    
    def __init__(self, config: Optional[SandboxConfig] = None):
        self.config = config or SandboxConfig()
        self._container_id: Optional[str] = None
    
    def _ensure_image(self) -> bool:
        """Ensure the Docker image is available."""
        try:
            result = subprocess.run(
                ["docker", "pull", self.config.image],
                capture_output=True,
                timeout=300
            )
            return result.returncode == 0
        except Exception:
            return False
    
    async def execute_task(self, task: dict) -> dict:
        """
        Execute a Playwright task in the sandbox.
        
        Args:
            task: {
                "type": "scrape" | "automate" | "screenshot",
                "url": "...",
                "actions": [...]  # for automate
            }
            
        Returns:
            {
                "id": "...",
                "success": true/false,
                "data": {...},
                "error": "..."
            }
        """
        import asyncio
        
        # Ensure image exists
        if not self._ensure_image():
            return {
                "id": task.get("id", "unknown"),
                "success": False,
                "error": f"Failed to pull image: {self.config.image}"
            }
        
        container_name = f"scb-playwright-{uuid.uuid4().hex[:8]}"
        
        # Build docker run command
        cmd = [
            "docker", "run", "--rm",
            "--name", container_name,
            "--network", "none" if not self.config.network else "bridge",
            "--memory", self.config.memory,
            "--cpus", str(self.config.cpus),
            "--pids-limit", str(self.config.pids_limit),
            "--read-only",
            "--tmpfs", "/tmp:rw,size=256m",
            "-v", "/dev/shm:/dev/shm",  # Required for Playwright
            self.config.image,
            "python3", "-c", f"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    task = {json.dumps(task)}
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        page = await context.new_page()
        
        try:
            await page.goto(task['url'], timeout=30000)
            
            if task.get('type') == 'scrape':
                title = await page.title()
                text = await page.evaluate('document.body.innerText.slice(0, 10000)')
                print(json.dumps({{'success': True, 'data': {{'title': title, 'text': text}}}}))
                
            elif task.get('type') == 'screenshot':
                screenshot = await page.screenshot()
                import base64
                print(json.dumps({{'success': True, 'data': {{'screenshot': base64.b64encode(screenshot).decode()}}}}))
                
            elif task.get('type') == 'automate':
                results = []
                for action in task.get('actions', []):
                    if action.get('action') == 'click':
                        await page.click(action.get('selector', ''))
                    elif action.get('action') == 'type':
                        await page.fill(action.get('selector', ''), action.get('value', ''))
                    elif action.get('action') == 'goto':
                        await page.goto(action.get('url', ''))
                    results.append(action)
                print(json.dumps({{'success': True, 'data': {{'results': results}}}}))
                    
        except Exception as e:
            print(json.dumps({{'success': False, 'error': str(e)}}))
        finally:
            await browser.close()

asyncio.run(main())
"""
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode == 0:
                try:
                    return json.loads(result.stdout)
                except json.JSONDecodeError:
                    return {
                        "success": False,
                        "error": "Invalid output from worker"
                    }
            else:
                return {
                    "success": False,
                    "error": result.stderr or "Container failed"
                }
                
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "Task timed out"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def is_available(self) -> bool:
        """Check if Docker is available."""
        try:
            result = subprocess.run(
                ["docker", "version"],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception:
            return False


# Convenience functions
async def scrape_url(url: str) -> dict:
    """Scrape a URL in the sandbox."""
    worker = SandboxedPlaywrightWorker()
    return await worker.execute_task({
        "id": str(uuid.uuid4()),
        "type": "scrape",
        "url": url
    })


async def screenshot_url(url: str) -> dict:
    """Take a screenshot of a URL in the sandbox."""
    worker = SandboxedPlaywrightWorker()
    return await worker.execute_task({
        "id": str(uuid.uuid4()),
        "type": "screenshot",
        "url": url
    })
