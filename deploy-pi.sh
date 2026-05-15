#!/bin/bash

# Deployment script for Raspberry Pi
# Run this from your local machine

PI_IP="192.168.0.103"
PI_USER="ubuntu"
PI_PASS="ronandsouza"
DOMAIN="thefetch.in"

echo "🚀 Starting deployment to Raspberry Pi..."

# Install sshpass if not installed (for password authentication)
if ! command -v sshpass &> /dev/null; then
    echo "Installing sshpass..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install hudochenkov/sshpass/sshpass
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get install -y sshpass
    fi
fi

# Build the project locally first
echo "📦 Building the project..."
npm run build

# Create deployment directory
echo "📁 Creating deployment package..."
mkdir -p deploy
cp -r dist/* deploy/
cp package.json deploy/
cp .env deploy/ 2>/dev/null || echo "No .env file found"

# Transfer files to Raspberry Pi
echo "📤 Transferring files to Raspberry Pi..."
sshpass -p "$PI_PASS" scp -r -o StrictHostKeyChecking=no deploy/* "$PI_USER@$PI_IP:/tmp/fetch-deploy/"

# Run setup on Raspberry Pi
echo "🔧 Setting up on Raspberry Pi..."
sshpass -p "$PI_PASS" ssh -o StrictHostKeyChecking=no "$PI_USER@$PI_IP" << 'ENDSSH'
    # Create app directory
    sudo mkdir -p /var/www/thefetch.in
    sudo cp -r /tmp/fetch-deploy/* /var/www/thefetch.in/
    sudo chown -R www-data:www-data /var/www/thefetch.in
    
    # Install nginx if not installed
    if ! command -v nginx &> /dev/null; then
        echo "Installing nginx..."
        sudo apt-get update
        sudo apt-get install -y nginx
    fi
    
    # Create nginx configuration
    sudo tee /etc/nginx/sites-available/thefetch.in > /dev/null << 'EOF'
server {
    listen 80;
    server_name thefetch.in www.thefetch.in;
    
    root /var/www/thefetch.in;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;
}
EOF
    
    # Enable site
    sudo ln -sf /etc/nginx/sites-available/thefetch.in /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test nginx configuration
    sudo nginx -t
    
    # Reload nginx
    sudo systemctl reload nginx
    
    echo "✅ Deployment complete!"
    echo "🌐 Your site should be accessible at http://$PI_IP"
    echo "📝 Next steps:"
    echo "   1. Point your DNS A record for thefetch.in to your static IP"
    echo "   2. Run: sudo certbot --nginx -d thefetch.in -d www.thefetch.in"
    echo "   3. This will set up SSL certificate automatically"
ENDSSH

echo "✨ Deployment script completed!"
echo "📋 DNS Configuration needed:"
echo "   - Create A record: thefetch.in -> YOUR_STATIC_IP"
echo "   - Create A record: www.thefetch.in -> YOUR_STATIC_IP"

