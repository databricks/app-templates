import shiny
from shiny import ui, render, reactive
from databricks.sdk import WorkspaceClient
import io
import pathlib

# Initialize WorkspaceClient
w = WorkspaceClient()

# Adjust to your target volume
catalog = 'main'
schema = 'default'
volume = 'my-volume'
volume_path = f"/Volumes/{catalog}/{schema}/{volume}"
volume_folder = 'my-folder'
volume_folder_path = f"{volume_path}/{volume_folder}"

# Shiny UI definition
app_ui = ui.page_fluid(
    ui.div(
        ui.h2("Upload files to a Databricks volume"),
        ui.markdown("This code sample demonstrates how you upload files to a Databricks [Unity catalog volume](https://docs.databricks.com/en/volumes/index.html)."),
        ui.markdown(f"The uploaded files will be stored under **{catalog}.{schema}.{volume}/{volume_folder}**. Change the source code to upload to a different volume."),
        ui.input_file("file", "Choose a file to upload", accept=None),
        ui.output_text("upload_status"),
        ui.markdown("Take a look at the [Shiny for Pyton ui.input_file documentation](https://shiny.posit.co/py/api/core/ui.input_file.html) to limit which file types can be uploaded."),
        style="margin-left: auto; margin-right: auto; max-width: 800px; margin-top: 20px;"
    )
)

def server(input, output, session):

    upload_status_output = reactive.Value("")

    @output
    @render.text
    def upload_status():
        return upload_status_output()
    
    
    @reactive.Effect
    @reactive.event(input.file)
    def upload_file():
        uploaded_file = input.file()
        if uploaded_file is not None and len(uploaded_file) > 0:
            # Accessing the first file in case multiple files are uploaded
            uploaded_file = uploaded_file[0]
            
            # Create folder if it doesn't exist
            w.files.create_directory(volume_folder_path)
            
            # Build file path
            volume_file_path = f"{volume_folder_path}/{uploaded_file['name']}"

            # Upload file
            try:
                file_path = pathlib.Path(uploaded_file['datapath'])
                with open(file_path, 'rb') as f:
                    file_bytes = f.read()
                binary_data = io.BytesIO(file_bytes)

                w.files.upload(volume_file_path, binary_data, overwrite=True)
                upload_status_output.set(f"File {uploaded_file['name']} has been successfully uploaded to {volume_file_path}.")
            except Exception as e:
                upload_status_output.set(f"Error uploading file: {e}")

app = shiny.App(app_ui, server)
