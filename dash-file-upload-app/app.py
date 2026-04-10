import dash
from dash import dcc, html, Input, Output, State
from databricks.sdk import WorkspaceClient
import io, base64

app = dash.Dash(__name__)
server = app.server

w = WorkspaceClient()

# Adjust to your target volume
catalog = 'main'
schema = 'default'
volume = 'my-volume'
volume_path = f"/Volumes/{catalog}/{schema}/{volume}"
volume_folder = 'my-folder'
volume_folder_path = f"{volume_path}/{volume_folder}"

app.layout = html.Div([
    
    html.Div([

    dcc.Markdown("# Upload files to a Databricks volume"),
    dcc.Markdown("This code sample demonstrates how you upload files to a Databricks "
           "[Unity Catalog volume](https://docs.databricks.com/en/volumes/index.html)."),
    dcc.Markdown(f"The uploaded files will be stored under **{catalog}.{schema}.{volume}/{volume_folder}**. "
           "Change the source code to upload to a different volume."),
    dcc.Upload(
        id='upload-data',
        children=html.Div([
            'Drag and drop or ',
            html.A('select Files')
        ]),
        style={
            'width': '100%',
            'height': '60px',
            'lineHeight': '60px',
            'borderWidth': '1px',
            'borderStyle': 'dashed',
            'borderRadius': '5px',
            'textAlign': 'center',
            'margin': '10px'
        },
        multiple=False
    ),
    html.Div(id='upload-status'),
    html.Div(id='folder-header'), html.Div(id='folder-contents'),
    dcc.Markdown("Take a look at the [Dash dcc.Upload documentation](https://dash.plotly.com/dash-core-components/upload) to adjust the file type and size limits.")
    ], style={'maxWidth': '800px', 'margin': '0 auto', 'textAlign': 'center', 'fontFamily': 'Arial, Helvetica, sans-serif'})
])


@app.callback(
    [Output('upload-status', 'children'),
    Output('folder-header', 'children')],
     Output('folder-contents', 'children'),
    [Input('upload-data', 'contents')],
    [State('upload-data', 'filename')]
)

def upload_to_databricks(contents, filename):
    if contents is None:
        return '', '', ''

    try:
        content_type, content_string = contents.split(',')
        decoded = base64.b64decode(content_string)

        # Create folder if it doesn't exist
        w.files.create_directory(volume_folder_path)

        # Build file path
        volume_file_path = f"{volume_folder_path}/{filename}"

        # Upload file
        binary_data = io.BytesIO(decoded)
        w.files.upload(volume_file_path, binary_data, overwrite=True)

        success_message = f"File '{filename}' has been successfully uploaded to '{volume_file_path}'."
    except Exception as e:
        return f"Error uploading file: {e}", ''

    # List the contents of the folder after uploading
    try:
        contents = w.files.list_directory_contents(volume_folder_path)
        contents_list = [html.P(item.path) for item in contents]
    except Exception as e:
        return success_message, html.H3("Contents of the volume folder:"), f"Error listing directory contents: {e}"

    return success_message, html.H3("Contents of the volume folder:"), contents_list

if __name__ == '__main__':
    app.run_server(debug=True)
