<template>
  <div class="search-results">
    <div class="result-toolbar">
    <button @click="selectAll">全选</button>
    <button @click="deselectAll">全不选</button>
    <button @click="addSelected">添加剧集</button>
</div>
    <div class="result-list">
      <li v-for="item in results" :key="item.id">
        <input type="checkbox" v-model="item.checked" /> {{ item.name }} (ID: {{ item.id }})
      </li>
    </div>
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

<style>
.search-results{
  border:1px solid #e5e5e5;
  border-radius:10px;
  margin-top:12px;
  background:white;
}

.result-toolbar{
  position:sticky;
  top:0;
  background:white;
  padding:10px;
  border-bottom:1px solid #eee;
  z-index:5;
}

.result-list{
  max-height:250px;
  overflow-y:auto;
  padding:8px;
}
</style>