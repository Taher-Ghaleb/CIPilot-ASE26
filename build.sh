#!/bin/bash
# Build script for Render.com deployment

set -e  # Exit on error

echo "🚀 Building CIPilot for deployment..."

# Build frontend
echo "📦 Building frontend..."
cd web
npm install
npm run build
cd ..

echo "✅ Build complete!"
echo ""
echo "Backend will be built by Render using: cd backend && pip install -r requirements.txt"
echo "Frontend static files are in: web/dist"
echo ""
echo "Next steps:"
echo "1. Push to GitHub: git push origin main"
echo "2. Create Blueprint in Render.com"
echo "3. No server configuration needed - users set API keys in the app!"
