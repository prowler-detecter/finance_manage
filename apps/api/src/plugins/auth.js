export async function authGuard(request, reply) {
  try {
    await request.jwtVerify();
  } catch (error) {
    reply.code(401).send({ message: "Unauthorized" });
  }
}
