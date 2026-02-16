#!/bin/bash

# NEXUS OS - Quick Start Script
# This script automates the setup process

echo "🚀 NEXUS OS - Quick Start Setup"
echo "================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js detected: $(node --version)"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed!"
    exit 1
fi

echo "✅ npm detected: $(npm --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "⚠️  .env.local not found"
    echo "📝 Creating .env.local from template..."
    
    if [ -f .env.local.example ]; then
        cp .env.local.example .env.local
        echo "✅ .env.local created"
        echo ""
        echo "⚠️  IMPORTANT: Edit .env.local and add your Gemini API key!"
        echo "   Get your key from: https://ai.google.dev/"
        echo ""
        
        # Ask if user wants to open the file
        read -p "Would you like to open .env.local now? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if command -v code &> /dev/null; then
                code .env.local
            elif command -v nano &> /dev/null; then
                nano .env.local
            elif command -v vim &> /dev/null; then
                vim .env.local
            else
                echo "Please open .env.local manually and add your API key"
            fi
        fi
    else
        echo "❌ .env.local.example not found"
        echo "Creating basic .env.local..."
        cat > .env.local << EOF
# Gemini AI API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Backend API URL
VITE_API_URL=http://localhost:3001
EOF
        echo "✅ Basic .env.local created"
        echo "⚠️  Please edit .env.local and add your Gemini API key"
    fi
else
    echo "✅ .env.local already exists"
fi

echo ""
echo "================================"
echo "🎉 Setup Complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Make sure you've added your GEMINI_API_KEY to .env.local"
echo "2. Run the application:"
echo ""
echo "   npm run dev:all"
echo ""
echo "3. Open your browser to: http://localhost:3000"
echo ""
echo "📚 Documentation:"
echo "   - Setup Guide: SETUP.md"
echo "   - Deployment: DEPLOYMENT.md"
echo "   - Improvements: IMPROVEMENTS.md"
echo ""
echo "🆘 Need help? Check SETUP.md for troubleshooting"
echo ""

# Ask if user wants to start the app now
read -p "Would you like to start the application now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 Starting NEXUS OS..."
    echo "   Frontend: http://localhost:3000"
    echo "   Backend:  http://localhost:3001"
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""
    npm run dev:all
fi
