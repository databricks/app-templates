from django.shortcuts import get_object_or_404, redirect, render
from django.contrib import messages
from django.views.decorators.http import require_POST

from .forms import TodoForm
from .models import Todo


def index(request):
    """List all todos."""
    todos = Todo.objects.all()
    form = TodoForm()
    return render(request, "todos/index.html", {"todos": todos, "form": form})


@require_POST
def add(request):
    """Add a new todo."""
    form = TodoForm(request.POST)
    if form.is_valid():
        form.save()
        messages.success(request, "Todo added successfully!")
    else:
        messages.error(request, "Please enter a task.")
    return redirect("todos:index")


@require_POST
def toggle(request, todo_id):
    """Toggle the completed status of a todo."""
    todo = get_object_or_404(Todo, pk=todo_id)
    todo.completed = not todo.completed
    todo.save(update_fields=["completed"])
    messages.success(request, "Todo updated successfully!")
    return redirect("todos:index")


@require_POST
def delete(request, todo_id):
    """Delete a todo."""
    todo = get_object_or_404(Todo, pk=todo_id)
    todo.delete()
    messages.success(request, "Todo deleted successfully!")
    return redirect("todos:index")
