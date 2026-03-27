import gradio as gr
from databricks.sdk import WorkspaceClient
import os, io

w = WorkspaceClient()

# Adjust to your target volume
catalog = 'main'
schema = 'default'
volume = 'my-volume'
volume_path = f"/Volumes/{catalog}/{schema}/{volume}"
volume_folder = 'my-folder'
volume_folder_path = f"{volume_path}/{volume_folder}"

def upload_file(file):
    if file is not None:
        # Create a directory in the volume if it doesn't exist
        w.files.create_directory(volume_folder_path)

        # Build file path
        file_name = os.path.basename(file)
        volume_file_path = f"{volume_folder_path}/{file_name}"
        
        # Upload file
        try:
            # Get binary data
            with open(file, 'rb') as f:
                file_bytes = f.read()
            binary_data = io.BytesIO(file_bytes)
            
            # Upload to Databricks volume
            w.files.upload(volume_file_path, binary_data, overwrite=True)
            success_message = f"File '{file_name}' has been successfully uploaded to '{volume_file_path}'."
            return success_message
        except Exception as e:
            return f"Error uploading file: {e}"

demo = gr.Interface(fn=upload_file, 
                     inputs=gr.File(label="Choose a file to upload"), 
                     outputs=gr.Textbox(label="Result"),
                     title="Upload files to a Databricks volume",
                     description=f"This code sample demonstrates how you upload files to a Databricks [Unity Catalog volume](https://docs.databricks.com/en/volumes/index.html).<br>The uploaded files will be stored under **{catalog}.{schema}.{volume}/{volume_folder}**. Change the source code to upload to a different volume.",
                     allow_flagging="never")

if __name__ == "__main__":
    demo.launch()