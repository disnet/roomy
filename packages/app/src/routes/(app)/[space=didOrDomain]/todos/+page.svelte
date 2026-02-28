<script lang="ts">
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { getAppState } from "$lib/queries";

  import MainLayout from "$lib/components/layout/MainLayout.svelte";
  import SidebarMain from "$lib/components/sidebars/SpaceSidebar.svelte";
  import { IconPlus, IconTrash, IconGripVertical, IconChatBubble, IconXMark } from "@roomy/design/icons";
  import { getTodoStore } from "$lib/stores/todoStore.svelte";
  import { dragHandleZone, dragHandle, SHADOW_ITEM_MARKER_PROPERTY_NAME } from "svelte-dnd-action";
  import type { Todo, TodoUser } from "$lib/stores/todoStore.svelte";
  import { peer, peerStatus } from "$lib/workers";
  import { Avatar } from "bits-ui";
  import { AvatarBeam } from "svelte-boring-avatars";
  import { cdnImageUrl } from "$lib/utils.svelte";

  const app = getAppState();

  const store = getTodoStore();

  let newTodoText = $state("");
  let showAll = $state(false);
  let isDragging = $state(false);
  let highlightedId = $state<string | null>(null);
  let focusedId = $state<string | null>(null);
  let assignPickerTodoId = $state<string | null>(null);

  type Member = { did: string; name?: string; handle?: string; avatar?: string };
  const membersPromise = $derived(
    app.space.status === "joined"
      ? peer.getMembers(app.space.space.id).then((list) => {
          // Ensure current user is included
          const me = getCurrentUser();
          if (me && !list.some((m) => m.did === me.did)) {
            return [{ did: me.did, name: me.name, avatar: me.avatar }, ...list];
          }
          return list;
        })
      : undefined,
  );

  // Local copy of items for the dnd zone — only mutated by dnd events during drag
  let dndItems = $state<Todo[]>([]);

  const spaceId = $derived(page.params.space);

  $effect(() => {
    if (spaceId) {
      store.load(spaceId);
      showAll = false;
    }
  });

  // Auto-expand and highlight if navigating to a specific todo
  let internalHashUpdate = false;
  $effect(() => {
    const hash = page.url.hash?.slice(1);
    if (!hash || store.todos.length === 0) return;
    if (internalHashUpdate) {
      internalHashUpdate = false;
      return;
    }
    const top5Ids = new Set(uncompleted.slice(0, 5).map((t) => t.id));
    if (!top5Ids.has(hash)) {
      showAll = true;
    }
    highlightedId = hash;
    focusedId = hash;
    // Scroll into view after DOM updates
    requestAnimationFrame(() => {
      document.getElementById(`todo-${hash}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // Fade the strong highlight after 2s, keep subtle one
    const timer = setTimeout(() => { highlightedId = null; }, 2000);
    return () => clearTimeout(timer);
  });

  const uncompleted = $derived(
    store.todos.filter((t) => !t.completed),
  );
  const completed = $derived(
    store.todos.filter((t) => t.completed),
  );
  const visibleUncompleted = $derived(
    showAll ? uncompleted : uncompleted.slice(0, 5),
  );
  const hiddenUncompleted = $derived(
    uncompleted.length > 5 ? uncompleted.length - 5 : 0,
  );
  const hasMore = $derived(hiddenUncompleted > 0 || completed.length > 0);

  // Sync dndItems from store when not dragging
  $effect(() => {
    if (!isDragging) {
      dndItems = visibleUncompleted.map((t) => ({ ...t }));
    }
  });

  function getCurrentUser(): TodoUser | undefined {
    if (peerStatus.authState?.state !== "authenticated") return undefined;
    return {
      did: peerStatus.authState.did,
      name: peerStatus.profile?.displayName,
      avatar: peerStatus.profile?.avatar,
    };
  }

  async function handleAdd() {
    const text = newTodoText.trim();
    if (!text) return;
    await store.addTodo(spaceId, text, { createdBy: getCurrentUser() });
    newTodoText = "";
  }

  async function handleAssign(todoId: string, member: Member) {
    await store.assignTodo(todoId, {
      did: member.did,
      name: member.name,
      avatar: member.avatar,
    });
    assignPickerTodoId = null;
  }

  async function handleUnassign(id: string, did: string) {
    await store.unassignTodo(id, did);
  }

  function toggleAssignPicker(todoId: string) {
    assignPickerTodoId = assignPickerTodoId === todoId ? null : todoId;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handleAdd();
    }
  }

  async function handleToggle(id: string) {
    await store.toggleTodo(id);
  }

  async function handleDelete(id: string) {
    await store.deleteTodo(id);
  }

  function handleTextKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }

  async function handleTextInput(id: string, e: Event) {
    const text = (e.target as HTMLInputElement).value.trim();
    if (text) {
      await store.updateText(id, text);
    }
  }

  // Flat list of all currently visible todos for keyboard navigation
  const allVisible = $derived(
    showAll
      ? [...visibleUncompleted, ...completed]
      : visibleUncompleted,
  );

  function moveSelection(delta: number) {
    if (allVisible.length === 0) return;
    const currentIdx = allVisible.findIndex((t) => t.id === focusedId);
    let nextIdx: number;
    if (currentIdx === -1) {
      nextIdx = delta > 0 ? 0 : allVisible.length - 1;
    } else {
      nextIdx = Math.max(0, Math.min(allVisible.length - 1, currentIdx + delta));
    }
    focusedId = allVisible[nextIdx].id;
    highlightedId = null;
    internalHashUpdate = true;
    replaceState(`/${spaceId}/todos#${focusedId}`, {});
    requestAnimationFrame(() => {
      document.getElementById(`todo-${focusedId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && assignPickerTodoId) {
      assignPickerTodoId = null;
      return;
    }

    // Don't intercept when typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter" && focusedId) {
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement>(`#todo-${focusedId} input[type="text"]`);
      input?.focus();
    }
  }

  function handleDndConsider(e: CustomEvent<{ items: Todo[] }>) {
    isDragging = true;
    dndItems = e.detail.items;
  }

  async function handleDndFinalize(e: CustomEvent<{ items: Todo[] }>) {
    // Filter out the shadow placeholder before persisting
    const finalItems = e.detail.items.filter(
      (item: any) => !item[SHADOW_ITEM_MARKER_PROPERTY_NAME],
    );
    dndItems = finalItems;
    isDragging = false;
    const ids = finalItems.map((item) => item.id);
    await store.reorderTodos(spaceId, [...ids, ...completed.map((t) => t.id)]);
  }
</script>

{#snippet assignees(todo: Todo)}
  <div class="flex items-center gap-0.5 shrink-0 relative">
    {#each todo.assignees ?? [] as assignee (assignee.did)}
      <div class="relative group/assignee" title={assignee.name ?? assignee.did}>
        <Avatar.Root class="size-5">
          <Avatar.Image
            src={assignee.avatar?.startsWith("atblob://") ? cdnImageUrl(assignee.avatar) : assignee.avatar}
            class="rounded-full size-5"
          />
          <Avatar.Fallback>
            <AvatarBeam size={20} name={assignee.did} />
          </Avatar.Fallback>
        </Avatar.Root>
        <button
          class="absolute -top-1 -right-1 hidden group-hover/assignee:flex size-3 items-center justify-center rounded-full bg-base-300 dark:bg-base-600"
          onclick={() => handleUnassign(todo.id, assignee.did)}
        >
          <IconXMark class="size-2" />
        </button>
      </div>
    {/each}
    <button
      class="size-5 rounded-full border border-dashed border-base-400 dark:border-base-500 flex items-center justify-center text-base-400 hover:text-accent-500 hover:border-accent-500 transition-colors"
      title="Assign user"
      onclick={(e) => { e.stopPropagation(); toggleAssignPicker(todo.id); }}
    >
      <IconPlus class="size-2.5" />
    </button>
    {#if assignPickerTodoId === todo.id}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute right-0 top-7 z-50 w-56 rounded-lg border border-base-300 dark:border-base-600 bg-base-100 dark:bg-base-800 shadow-lg py-1 max-h-48 overflow-y-auto"
        onclick={(e) => e.stopPropagation()}
      >
        {#await membersPromise}
          <div class="px-3 py-2 text-xs text-base-400">Loading...</div>
        {:then memberList}
          {#each memberList ?? [] as member (member.did)}
            {@const alreadyAssigned = (todo.assignees ?? []).some((a) => a.did === member.did)}
            <button
              class="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-base-200 dark:hover:bg-base-700 disabled:opacity-40 disabled:cursor-default"
              disabled={alreadyAssigned}
              onclick={() => handleAssign(todo.id, member)}
            >
              <Avatar.Root class="size-5">
                <Avatar.Image
                  src={member.avatar?.startsWith("atblob://") ? cdnImageUrl(member.avatar) : member.avatar}
                  class="rounded-full size-5"
                />
                <Avatar.Fallback>
                  <AvatarBeam size={20} name={member.did} />
                </Avatar.Fallback>
              </Avatar.Root>
              <span class="truncate">{member.name ?? member.handle ?? member.did}</span>
              {#if alreadyAssigned}
                <span class="ml-auto text-xs text-base-400">assigned</span>
              {/if}
            </button>
          {/each}
        {/await}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet sidebar()}
  <SidebarMain />
{/snippet}

{#snippet navbar()}
  <div class="relative w-full">
    <div class="flex flex-col items-center justify-between w-full px-2">
      <h2
        class="w-full py-4 text-base-900 dark:text-base-100 flex items-center gap-2"
      >
        <div class="ml-2 font-bold grow text-center text-lg">Todos</div>
      </h2>
    </div>
  </div>
{/snippet}

<svelte:window onkeydown={handleGlobalKeydown} onclick={() => { assignPickerTodoId = null; }} />

<MainLayout {sidebar} {navbar}>
  <div class="flex flex-col items-center w-full h-full p-4 overflow-y-auto">
    <div class="w-full max-w-lg flex flex-col gap-4">
      <!-- Quick-add input -->
      <div class="flex gap-2">
        <input
          type="text"
          class="input input-bordered flex-1 bg-base-200 dark:bg-base-800 border-base-300 dark:border-base-700 rounded-lg px-3 py-2 text-sm"
          placeholder="Add a todo..."
          bind:value={newTodoText}
          onkeydown={handleKeydown}
        />
        <button
          class="btn btn-sm btn-primary rounded-lg px-3"
          onclick={handleAdd}
          disabled={!newTodoText.trim()}
        >
          <IconPlus class="size-4" />
        </button>
      </div>

      <!-- Todo list -->
      {#if uncompleted.length === 0 && completed.length === 0}
        <div
          class="text-center text-base-500 dark:text-base-400 py-8 text-sm"
        >
          No todos yet. Add one above!
        </div>
      {:else}
        <div
          class="flex flex-col gap-1"
          use:dragHandleZone={{
            items: dndItems,
            type: "todo",
            dropTargetClasses: ["bg-accent-500/10", "rounded"],
            dropTargetStyle: {
              outline: "2px solid var(--color-accent-500/30)",
            },
          }}
          onconsider={handleDndConsider}
          onfinalize={handleDndFinalize}
        >
          {#each dndItems as todo (todo.id)}
            <div
              id={`todo-${todo.id}`}
              class={[
                "flex items-center gap-2 rounded-lg px-3 py-2 group transition-colors duration-500",
                highlightedId === todo.id
                  ? "bg-accent-200 dark:bg-accent-800 ring-2 ring-accent-400"
                  : focusedId === todo.id
                    ? "bg-base-200 dark:bg-base-700"
                    : "bg-base-100 dark:bg-base-800 hover:bg-base-200 dark:hover:bg-base-700",
              ]}
            >
              <div use:dragHandle aria-label="drag-handle" class="cursor-grab text-base-400 hover:text-base-600">
                <IconGripVertical class="size-3.5" />
              </div>
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={todo.completed}
                onchange={() => handleToggle(todo.id)}
              />
              <input
                type="text"
                class="flex-1 min-w-0 text-sm bg-transparent outline-none border-none p-0 shadow-none ring-0 focus:outline-none focus:border-none focus:ring-0 focus:shadow-none text-ellipsis overflow-hidden"
                value={todo.text}
                onkeydown={handleTextKeydown}
                onchange={(e) => handleTextInput(todo.id, e)}
              />
              {@render assignees(todo)}
              {#if todo.source?.type === "message"}
                <a
                  href={`/${spaceId}/${todo.source.roomId}`}
                  class="text-base-400 hover:text-accent-500 transition-colors"
                  title="Go to message"
                >
                  <IconChatBubble class="size-3.5" />
                </a>
              {/if}
              <button
                class="opacity-0 group-hover:opacity-100 transition-opacity text-base-400 hover:text-red-500"
                onclick={() => handleDelete(todo.id)}
              >
                <IconTrash class="size-3.5" />
              </button>
            </div>
          {/each}
        </div>

        <!-- See all / show less -->
        {#if hasMore}
          <button
            class="text-sm text-accent-600 dark:text-accent-400 hover:underline self-start"
            onclick={() => (showAll = !showAll)}
          >
            {showAll ? "Show less" : `See all (${hiddenUncompleted > 0 ? `${hiddenUncompleted} remaining` : ""}${hiddenUncompleted > 0 && completed.length > 0 ? ", " : ""}${completed.length > 0 ? `${completed.length} completed` : ""})`}
          </button>
        {/if}

        <!-- Completed todos (only when showAll) -->
        {#if showAll && completed.length > 0}
          <div class="flex flex-col gap-1 mt-2">
            <div
              class="text-xs font-semibold text-base-500 dark:text-base-400 uppercase tracking-wide mb-1"
            >
              Completed
            </div>
            {#each completed as todo (todo.id)}
              <div
                id={`todo-${todo.id}`}
                class={[
                  "flex items-center gap-2 rounded-lg px-3 py-2 group transition-colors duration-500",
                  highlightedId === todo.id
                    ? "bg-accent-200 dark:bg-accent-800 ring-2 ring-accent-400"
                    : focusedId === todo.id
                      ? "bg-base-200/70 dark:bg-base-700/70"
                      : "bg-base-100/50 dark:bg-base-800/50",
                ]}
              >
                <div class="w-3.5"></div>
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked={todo.completed}
                  onchange={() => handleToggle(todo.id)}
                />
                <input
                  type="text"
                  class="flex-1 min-w-0 text-sm bg-transparent outline-none border-none p-0 shadow-none ring-0 focus:outline-none focus:border-none focus:ring-0 focus:shadow-none text-ellipsis overflow-hidden line-through text-base-400"
                  value={todo.text}
                  onkeydown={handleTextKeydown}
                onchange={(e) => handleTextInput(todo.id, e)}
                />
                {@render assignees(todo)}
                {#if todo.source?.type === "message"}
                  <a
                    href={`/${spaceId}/${todo.source.roomId}`}
                    class="text-base-400 hover:text-accent-500 transition-colors"
                    title="Go to message"
                  >
                    <IconChatBubble class="size-3.5" />
                  </a>
                {/if}
                <button
                  class="opacity-0 group-hover:opacity-100 transition-opacity text-base-400 hover:text-red-500"
                  onclick={() => handleDelete(todo.id)}
                >
                  <IconTrash class="size-3.5" />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</MainLayout>
