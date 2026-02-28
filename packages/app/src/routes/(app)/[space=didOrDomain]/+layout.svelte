<script lang="ts">
  import { page } from "$app/state";
  import { peer } from "$lib/workers";
  import type { SpaceIdOrHandle } from "$lib/workers/types";
  import { getTodoStore } from "$lib/stores/todoStore.svelte";

  const todoStore = getTodoStore();

  // When this layout loads, we have access to page.params.space
  // We should notify the peer so it can prioritize materialization
  $effect(() => {
    const spaceId = page.params.space;
    if (spaceId) {
      console.debug("[Space Layout] Setting current space:", spaceId);
      peer.setCurrentSpace(spaceId as SpaceIdOrHandle);
      todoStore.load(spaceId);
    }
  });
</script>

<slot />
