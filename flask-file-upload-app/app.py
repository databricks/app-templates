from flask import Flask, request, render_template
from databricks.sdk import WorkspaceClient
import io

app = Flask(__name__)

w = WorkspaceClient()

# Adjust to your target volume
catalog = 'main'
schema = 'default'
volume = 'my-volume'
volume_path = f"/Volumes/{catalog}/{schema}/{volume}"
volume_folder = 'my-folder'
volume_folder_path = f"{volume_path}/{volume_folder}"

@app.route('/', methods=['GET', 'POST'])
def upload_file():
    error_message = None
    success_message = None
    folder_contents = []

    if request.method == 'POST':
        if 'file' not in request.files:
            error_message = 'No file part'
        else:
            uploaded_file = request.files['file']

            if uploaded_file.filename == '':
                error_message = 'No selected file'
            else:
                # Create folder if it doesn't exist
                w.files.create_directory(volume_folder_path)

                # Build file path
                volume_file_path = f"{volume_folder_path}/{uploaded_file.filename}"

                # Upload file
                try:
                    file_bytes = uploaded_file.read()
                    binary_data = io.BytesIO(file_bytes)

                    w.files.upload(volume_file_path, binary_data, overwrite=True)
                    success_message = f"File '{uploaded_file.filename}' has been successfully uploaded to '{volume_file_path}'."
                except Exception as e:
                    error_message = f"Error uploading file: {e}"

                # List the contents of the folder after uploading
                try:
                    contents = w.files.list_directory_contents(volume_folder_path)
                    folder_contents = [item.path for item in contents]
                except Exception as e:
                    error_message = f"Error listing directory contents: {e}"

    return render_template('index.html', path=f"{catalog}.{schema}.{volume}/{volume_folder}", 
                           error_message=error_message, success_message=success_message, 
                           folder_contents=folder_contents)

if __name__ == '__main__':
    app.run()