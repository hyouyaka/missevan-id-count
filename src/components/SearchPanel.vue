<template>
  <div class="search-panel">
    <input v-model="keyword" @keyup.enter="search" placeholder="输入关键词搜索剧集" />
    <button @click="search">搜索</button>
  </div>
</template>

<script>
export default {
  name: "SearchPanel",
  data() {
    return { keyword: "" };
  },
  methods: {
    async search() {
      if (!this.keyword.trim()) return;
      try {
        const resp = await fetch(`http://localhost:3000/search?keyword=${encodeURIComponent(this.keyword)}`);
        const data = await resp.json();
        if (data.success) {
          this.$emit("updateResults", data.results);
        } else {
          alert("搜索失败或无结果");
        }
      } catch (err) {
        console.error(err);
        alert("搜索失败，请检查服务器");
      }
    },
  },
};
</script>