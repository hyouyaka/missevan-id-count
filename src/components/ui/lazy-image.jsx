function LazyImage({ loading = "lazy", decoding = "async", ...props }) {
  return <img loading={loading} decoding={decoding} {...props} />;
}

export { LazyImage };
