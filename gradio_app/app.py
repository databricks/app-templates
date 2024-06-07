import gradio as gr
import os

def alternatingly_agree(message, history):
    if len(history) % 2 == 0:
        return f"Yes, I do think that '{message}'"
    else:
        return "I don't this is quite right"

gr.ChatInterface(alternatingly_agree).launch()
