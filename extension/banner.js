// Banner functions for CIPilot Extension
function getLoadingSpinner() {
    const spinner = document.createElement('span');
    spinner.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 50 50" style="vertical-align:middle;">
            <defs>
                <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="rgb(8, 114, 147)"/>
                    <stop offset="100%" stop-color="rgb(113, 113, 6)"/>
                </linearGradient>
            </defs>
            <circle cx="25" cy="25" r="20" fill="none" stroke="url(#spinner-gradient)" stroke-width="5" stroke-linecap="round" stroke-dasharray="31.415, 31.415" transform="rotate(0 25 25)">
                <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
            </circle>
        </svg>
    `;
    spinner.style.marginLeft = '10px';
    spinner.title = 'Detecting more CI services...';
    return spinner;
}

function showOrUpdateBanner(services, loading = false) {
    // If no services detected and not loading, hide or remove the banner
    if (services.length === 0 && !loading) {
        if (window.ciPilotBanner) {
            window.ciPilotBanner.style.display = 'none';
        }
        return;
    }

    if (!window.ciPilotBanner) {
        window.ciPilotBanner = document.createElement('div');
        window.ciPilotBanner.id = 'cipilot-banner';
        window.ciPilotBanner.style.position = 'relative';
        window.ciPilotBanner.style.top = '0';
        window.ciPilotBanner.style.left = '0';
        window.ciPilotBanner.style.width = '100%';
        window.ciPilotBanner.style.background = '#f2f3f1'; // lighter background
        window.ciPilotBanner.style.color = '#24292f'; // darker text for contrast
        window.ciPilotBanner.style.zIndex = '9999';
        window.ciPilotBanner.style.padding = '10px 0';
        window.ciPilotBanner.style.textAlign = 'center';
        window.ciPilotBanner.style.fontSize = '14px';
        window.ciPilotBanner.style.fontFamily = 'sans-serif';
        // Insert after GitHub header if possible, else at top of body
        const header = document.querySelector('header');
        if (header && header.parentNode) {
            header.parentNode.insertBefore(window.ciPilotBanner, header.nextSibling);
        } else {
            document.body.prepend(window.ciPilotBanner);
        }
    }
    
    const banner = window.ciPilotBanner;
    banner.style.display = 'block'; // Show the banner
    
    // Preserve existing conversion/migration div if it exists
    const existingConversionDiv = banner.querySelector('div[style*="background: #fff3cd"]') || 
                                   banner.querySelector('div[style*="background: rgb(255, 243, 205)"]');
    
    banner.textContent = '';
    
    if (services.length > 0) {
        const label = document.createElement('span');
        label.textContent = 'Detected CI services:';
        label.style.color = '#FFD700';
        label.style.fontWeight = 'bold';
        label.style.fontSize = '16px';
        label.style.marginRight = '10px';
        label.style.background = 'linear-gradient(90deg,rgb(8, 114, 147) 0%,rgb(113, 113, 6) 100%)';
        label.style.backgroundClip = 'text';
        label.style.webkitTextFillColor = 'transparent';
        label.style.backgroundClip = 'text';
        label.style.textFillColor = 'transparent';
        const list = document.createElement('span');
        list.style.fontSize = '14px';
        services.forEach((service, idx) => {
            if (service.url && service.url !== '#') {
                const link = document.createElement('a');
                link.textContent = service.text;
                link.href = service.url;
                link.target = '_blank';
                link.style.color = '#0a3ea8';
                link.style.textDecoration = 'underline';
                link.style.marginRight = '8px';
                list.appendChild(link);
            } else {
                const span = document.createElement('span');
                span.textContent = service.text;
                span.style.color = '#0a3ea8';
                span.style.marginRight = '8px';
                list.appendChild(span);
            }
            if (idx < services.length - 1) {
                list.appendChild(document.createTextNode(', '));
            }
        });
        banner.appendChild(label);
        banner.appendChild(list);
        if (loading) {
            banner.appendChild(getLoadingSpinner());
        }
        
        // Restore the conversion div if it existed
        if (existingConversionDiv) {
            banner.appendChild(existingConversionDiv);
        }
    }
}
