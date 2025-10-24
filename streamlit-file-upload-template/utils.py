import os
import mimetypes
from datetime import datetime

def get_file_metadata(file):
    """Extract metadata from uploaded file"""
    metadata = {
        'filename': file.name,
        'size': f"{file.size / 1024:.2f} KB",
        'type': mimetypes.guess_type(file.name)[0] or 'Unknown',
        'extension': os.path.splitext(file.name)[1] or 'No extension',
        'last_modified': datetime.fromtimestamp(os.path.getmtime(file.name) if os.path.exists(file.name) else 0).strftime('%Y-%m-%d %H:%M:%S')
    }
    return metadata