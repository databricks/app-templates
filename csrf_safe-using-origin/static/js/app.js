// Function to handle form submission
function handleFormSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(this);
    const data = new URLSearchParams();
    
    for (let [key, value] of formData.entries()) {
        data.append(key, value);
    }
    
    fetch(window.location.href, {
        method: 'POST',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: data.toString()
    })
    .then(response => {
        if (response.ok) {
            return response.text();
        } else {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return response.json().then(err => {
                    throw new Error(err.error || 'Request failed');
                });
            } else {
                return response.text().then(html => {
                    throw new Error('Wrong Query/Do not have access to table');
                });
            }
        }
    })
    .then(html => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        const newMain = tempDiv.querySelector('main');
        const currentMain = document.querySelector('main');
        
        if (newMain && currentMain) {
            currentMain.innerHTML = newMain.innerHTML;
        }
        
        attachEventListeners();
    })
    .catch(error => {
        alert('Error: ' + error.message);
    });
}

// Function to attach event listeners
function attachEventListeners() {
    const form = document.getElementById('query-form');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }
    
    const zipInput = document.getElementById('pickup_zip');
    if (zipInput) {
        zipInput.addEventListener('input', function() {
            // Use textContent instead of innerHTML for XSS protection
            const preview = document.getElementById('zip-preview');
            if (preview) {
                preview.textContent = "'" + (this.value || 'value') + "'";
            }
        });
    }
}

// Initial setup
document.addEventListener('DOMContentLoaded', attachEventListeners);