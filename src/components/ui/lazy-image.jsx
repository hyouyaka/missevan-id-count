function LazyImage({ alt = "", loading = "lazy", decoding = "async", ...props }) {
  return <img alt={alt} loading={loading} decoding={decoding} {...props} />;
}

export { LazyImage };
