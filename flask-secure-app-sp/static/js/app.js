// Function to get current CSRF token
function getCurrentCsrfToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    return metaTag ? metaTag.getAttribute('content') : '';
}

// Function to handle form submission
function handleFormSubmit(e) {
    e.preventDefault();
    
    const currentToken = getCurrentCsrfToken();
    const formData = new FormData(this);
    const data = new URLSearchParams();
    
    for (let [key, value] of formData.entries()) {
        data.append(key, value);
    }
    
    fetch(window.location.href, {
        method: 'POST',
        headers: {
            'X-CSRFToken': currentToken,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: data.toString()
    })
    .then(response => {
        if (response.ok) {
            return response.text();
        } else {
            // Check if response is JSON or HTML
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return response.json().then(err => {
                    throw new Error(err.error || 'Request failed');
                });
            } else {
                // Server returned HTML error page (like 500 error)
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
        
        // Update CSRF token if changed
        const newCsrfToken = tempDiv.querySelector('meta[name="csrf-token"]');
        if (newCsrfToken) {
            const newTokenValue = newCsrfToken.getAttribute('content');
            const currentCsrfToken = document.querySelector('meta[name="csrf-token"]');
            if (currentCsrfToken) {
                currentCsrfToken.setAttribute('content', newTokenValue);
            }
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
    
    const columnInput = document.getElementById('column_name');
    if (columnInput) {
        columnInput.addEventListener('input', function() {
            document.getElementById('column-preview').textContent = this.value || 'column';
        });
    }
    
    const tableInput = document.getElementById('table_name');
    if (tableInput) {
        tableInput.addEventListener('input', function() {
            document.getElementById('table-preview').textContent = this.value || 'table';
        });
    }
}

// Initial setup
document.addEventListener('DOMContentLoaded', attachEventListeners); 