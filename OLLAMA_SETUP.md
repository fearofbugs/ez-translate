# Ollama Setup Guide

## 1. Install and Configure Ollama

1. **Download Ollama**
   - Visit [Ollama website](https://ollama.ai/) to download and install
   - Or use command line: `curl -fsSL https://ollama.ai/install.sh | sh`

2. **Configure CORS access (Important)**
   ```bash
   # Set environment variable to allow browser extension access
   export OLLAMA_ORIGINS="*"
   # Or more secure way, only allow extensions
   export OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"
   ```

3. **Start Ollama service**
   ```bash
   ollama serve
   ```
   Runs by default on `http://localhost:11434`

4. **Download models**
   ```bash
   # Download a lightweight model (recommended for translation)
   ollama pull qwen2:1.5b
   
   # Or download other models
   ollama pull llama3.1:8b
   ollama pull gemma3:4b
   ```

## 2. Configure Ollama in Extension

1. **Open extension settings**
   - Right-click the LLM-Translate icon in browser toolbar
   - Select "Settings" or "Options"

2. **Switch to Ollama tab**
   - Click the "Ollama" tab in the settings page

3. **Configure server URL**
   - Enter Ollama server URL: `http://localhost:11434`
   - Modify accordingly if Ollama runs on different address/port

4. **Fetch model list**
   - Click "Fetch Models" button
   - Extension will retrieve available models from your Ollama server

5. **Select model**
   - Choose your desired model from the dropdown
   - Model selection is automatically saved

## 3. Use Translation Features

After configuration, you can:
- Select text on web pages and click translate icon
- Use extension popup for text translation
- All translation requests will be processed by your local Ollama model

## Recommended Models

- **qwen2:1.5b** - Lightweight, fast, good for basic translation
- **llama3.1:8b** - Larger model, higher translation quality
- **gemma3:4b** - Developed by Google, balanced performance and quality

## Troubleshooting

### CORS Access Issues (403 Forbidden)
If you encounter "403 Forbidden" or "Ollama server refused request" errors:

1. **Temporary solution**:
   ```bash
   # Stop Ollama service
   pkill ollama
   
   # Set environment variable and restart
   export OLLAMA_ORIGINS="*"
   ollama serve
   ```

2. **Permanent solution**:
   ```bash
   # Create config directory
   mkdir -p ~/.ollama
   
   # Add environment variable to config file
   echo 'OLLAMA_ORIGINS="*"' >> ~/.ollama/ollama.env
   
   # Restart Ollama
   ollama serve
   ```

3. **Verify CORS settings**:
   ```bash
   curl -X OPTIONS http://localhost:11434/api/generate \
     -H "Origin: chrome-extension://test" \
     -H "Access-Control-Request-Method: POST" \
     -v
   ```

### Other Common Issues
- **Cannot connect to Ollama**: Ensure Ollama service is running and URL is correct
- **Empty model list**: Make sure you have downloaded at least one model
- **Translation fails**: Check if model is properly loaded, try restarting Ollama service
