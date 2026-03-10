<template>
  <div class="search-results">
    <button @click="selectAll">全选</button>
    <button @click="deselectAll">全不选</button>
    <button @click="addSelected">添加剧集</button>

    <ul>
      <li v-for="item in results" :key="item.id">
        <input type="checkbox" v-model="item.checked" /> {{ item.name }} (ID: {{ item.id }})
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  name: "SearchResults",
  props: { results: Array },
  methods: {
    selectAll() {
      this.results.forEach((r) => (r.checked = true));
    },
    deselectAll() {
      this.results.forEach((r) => (r.checked = false));
    },
    addSelected() {
      const selectedIds = this.results.filter((r) => r.checked).map((r) => r.id);
      this.$emit("addDramas", selectedIds);
    },
  },
};
</script>