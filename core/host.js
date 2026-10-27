// Validate the literal authority, rather than accepting URL parser aliases.
export function requireLocalHost(request, response, next) {
  if (typeof request.headers.host === "string"
      && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(request.headers.host)) {
    next();
    return;
  }
  response.status(403).send("Forbidden Host");
}
