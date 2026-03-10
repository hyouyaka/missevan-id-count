// stores/searchResults.js
import { defineStore } from "pinia";
import { searchDrama } from "../service.js";

export const useSearchStore = defineStore("searchResults", {
  state: () => ({
    results: [],
    selectedIds: [],
    loading: false,
  }),
  actions: {
    async search(keyword) {
      this.loading = true;
      this.results = await searchDrama(keyword);
      this.loading = false;
      this.selectedIds = [];
    },
    toggleSelect(id) {
      if (this.selectedIds.includes(id)) {
        this.selectedIds = this.selectedIds.filter((x) => x !== id);
      } else {
        this.selectedIds.push(id);
      }
    },
    selectAll() {
      this.selectedIds = this.results.map((r) => r.id);
    },
    deselectAll() {
      this.selectedIds = [];
    },
  },
});