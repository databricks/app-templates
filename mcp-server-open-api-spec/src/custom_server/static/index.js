document.addEventListener('DOMContentLoaded', () => {
    const fullHost = `https://${window.location.hostname}/mcp`;
    // Update all elements with class "app-host"
    document.querySelectorAll('.app-host').forEach(el => {
        el.textContent = fullHost;
    });

    const pyCode = document.querySelector('pre code.language-python');
    if (pyCode) {
        pyCode.textContent = pyCode.textContent.replace('databricks-app-url', fullHost);
    }

    hljs.highlightAll();
});
