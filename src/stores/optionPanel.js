// stores/optionPanel.js
import { defineStore } from "pinia";

export const useOptionStore = defineStore("optionPanel", {
  state: () => ({
    dramas: [],
  }),
  actions: {
    addDramas(dramas) {
      this.dramas.push(...dramas);
    },
  },
});