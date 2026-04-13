from django.shortcuts import get_object_or_404, redirect, render
from django.contrib import messages
from django.views.decorators.http import require_POST

from .models import Todo


def index(request):
    """List all todos."""
    todos = Todo.objects.all()
    return render(request, "todos/index.html", {"todos": todos})


def add(request):
    """Add a new todo."""
    if request.method == "POST":
        task = request.POST.get("task", "").strip()
        if task:
            Todo.objects.create(task=task)
            messages.success(request, "Todo added successfully!")
        else:
            messages.error(request, "Please enter a task.")
    return redirect("todos:index")


@require_POST
def toggle(request, todo_id):
    """Toggle the completed status of a todo."""
    todo = get_object_or_404(Todo, pk=todo_id)
    todo.completed = not todo.completed
    todo.save()
    messages.success(request, "Todo updated successfully!")
    return redirect("todos:index")


@require_POST
def delete(request, todo_id):
    """Delete a todo."""
    todo = get_object_or_404(Todo, pk=todo_id)
    todo.delete()
    messages.success(request, "Todo deleted successfully!")
    return redirect("todos:index")
