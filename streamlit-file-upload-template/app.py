import streamlit as st
from utils import get_file_metadata

st.title('File Upload Template')

# File uploader with no type restriction
uploaded_file = st.file_uploader("Choose a file", type=None)

if uploaded_file is not None:
    # Display file metadata
    metadata = get_file_metadata(uploaded_file)
    
    st.subheader('File Metadata')
    
    # Create three columns for better layout
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.metric("Filename", metadata['filename'])
        st.metric("File Size", metadata['size'])
    
    with col2:
        st.metric("File Type", metadata['type'])
        st.metric("Extension", metadata['extension'])
    
    with col3:
        st.metric("Last Modified", metadata['last_modified'])
    
    # Display file contents preview if it's a text file
    if metadata['type'] and 'text' in metadata['type'].lower():
        
        try:
            st.subheader('File Preview')
            content = uploaded_file.read().decode()
            st.text_area("Content Preview", content[:1000] + ("..." if len(content) > 1000 else ""), 
                        height=200)
        except:
            None