import matplotlib.pyplot as plt
import numpy as np
from shiny.express import ui, input, render

with ui.sidebar():
  ui.tags.h1("Hello World!")
  ui.input_slider("n", "Number of bins", 0, 100, 20)

@render.plot(alt="A histogram")
def histogram():
  np.random.seed(12345)
  x = 100 + 15 * np.random.randn(500)
  plt.hist(x, input.n(), density=True)
