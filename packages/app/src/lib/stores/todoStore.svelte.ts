export interface TodoSource {
  type: "message";
  roomId: string;
  messageId: string;
}

export interface TodoUser {
  did: string;
  name?: string;
  avatar?: string;
}

export interface Todo {
  id: string;
  spaceId: string;
  text: string;
  completed: boolean;
  order: number;
  source?: TodoSource;
  createdBy?: TodoUser;
  assignees?: TodoUser[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("demo-todo", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("todos")) {
        const store = db.createObjectStore("todos", { keyPath: "id" });
        store.createIndex("spaceId", "spaceId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

async function getAllTodosForSpace(spaceId: string): Promise<Todo[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("todos", "readonly");
    const store = tx.objectStore("todos");
    const index = store.index("spaceId");
    const request = index.getAll(spaceId);
    request.onsuccess = () => {
      const todos = (request.result as Todo[]).sort(
        (a, b) => a.order - b.order,
      );
      resolve(todos);
    };
    request.onerror = () => reject(request.error);
  });
}

async function putTodo(todo: Todo): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    // Strip any non-serializable properties (e.g. from svelte-dnd-action / $state proxies)
    const cleanUser = (u: TodoUser) => ({ did: u.did, ...(u.name && { name: u.name }), ...(u.avatar && { avatar: u.avatar }) });
    const clean: Todo = {
      id: todo.id,
      spaceId: todo.spaceId,
      text: todo.text,
      completed: todo.completed,
      order: todo.order,
      ...(todo.source && { source: { type: todo.source.type, roomId: todo.source.roomId, messageId: todo.source.messageId } }),
      ...(todo.createdBy && { createdBy: cleanUser(todo.createdBy) }),
      ...(todo.assignees?.length && { assignees: todo.assignees.map(cleanUser) }),
    };
    store.put(clean);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeTodo(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getTodoById(id: string): Promise<Todo | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("todos", "readonly");
    const store = tx.objectStore("todos");
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as Todo | undefined);
    request.onerror = () => reject(request.error);
  });
}

let _instance: TodoStore | null = null;

export function getTodoStore(): TodoStore {
  if (!_instance) _instance = new TodoStore();
  return _instance;
}

export class TodoStore {
  todos = $state<Todo[]>([]);
  private currentSpaceId = "";

  /** Reactive lookup: messageId -> Todo (for todos created from messages) */
  get todosByMessageId(): Map<string, Todo> {
    const map = new Map<string, Todo>();
    for (const t of this.todos) {
      if (t.source?.type === "message") {
        map.set(t.source.messageId, t);
      }
    }
    return map;
  }

  async load(spaceId: string) {
    this.currentSpaceId = spaceId;
    this.todos = await getAllTodosForSpace(spaceId);
  }

  async addTodo(spaceId: string, text: string, opts?: { source?: TodoSource; createdBy?: TodoUser }) {
    const maxOrder = this.todos.reduce(
      (max, t) => Math.max(max, t.order),
      -1,
    );
    const todo: Todo = {
      id: crypto.randomUUID(),
      spaceId,
      text,
      completed: false,
      order: maxOrder + 1,
      ...(opts?.source && { source: opts.source }),
      ...(opts?.createdBy && { createdBy: opts.createdBy }),
      assignees: [],
    };
    await putTodo(todo);
    this.todos = [...this.todos, todo];
  }

  async assignTodo(id: string, user: TodoUser) {
    const todo = await getTodoById(id);
    if (!todo) return;
    const assignees = todo.assignees ?? [];
    if (assignees.some((a) => a.did === user.did)) return;
    todo.assignees = [...assignees, user];
    await putTodo(todo);
    this.todos = this.todos.map((t) => (t.id === id ? { ...todo } : t));
  }

  async unassignTodo(id: string, did: string) {
    const todo = await getTodoById(id);
    if (!todo) return;
    todo.assignees = (todo.assignees ?? []).filter((a) => a.did !== did);
    await putTodo(todo);
    this.todos = this.todos.map((t) => (t.id === id ? { ...todo } : t));
  }

  async updateText(id: string, text: string) {
    const todo = await getTodoById(id);
    if (!todo) return;
    todo.text = text;
    await putTodo(todo);
    this.todos = this.todos.map((t) => (t.id === id ? { ...todo } : t));
  }

  async toggleTodo(id: string) {
    const todo = await getTodoById(id);
    if (!todo) return;
    todo.completed = !todo.completed;
    await putTodo(todo);
    this.todos = this.todos.map((t) => (t.id === id ? { ...todo } : t));
  }

  async reorderTodos(spaceId: string, orderedIds: string[]) {
    const updates: Promise<void>[] = [];
    const newTodos = [...this.todos];
    for (let i = 0; i < orderedIds.length; i++) {
      const idx = newTodos.findIndex((t) => t.id === orderedIds[i]);
      if (idx !== -1) {
        newTodos[idx] = { ...newTodos[idx], order: i };
        updates.push(putTodo(newTodos[idx]));
      }
    }
    await Promise.all(updates);
    this.todos = newTodos.sort((a, b) => a.order - b.order);
  }

  async deleteTodo(id: string) {
    await removeTodo(id);
    this.todos = this.todos.filter((t) => t.id !== id);
  }
}
