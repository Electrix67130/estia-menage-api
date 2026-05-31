import fp from 'fastify-plugin';
import OrganizationMemberService from './organization-member.service';

export default fp(
  (fastify, _opts, done) => {
    const service = new OrganizationMemberService(fastify.db);

    // GET /organization-members/me — liste des memberships du user courant (deja inclus dans /auth/me,
    // mais expose ici pour pouvoir refresh la liste apres un switch ou apres creation d'une nouvelle org).
    fastify.get('/organization-members/me', { preHandler: [fastify.authenticate] }, async (request) => {
      const memberships = await service.findByUser(request.user.sub);
      return memberships.map((m) => ({
        organization_id: m.organization_id,
        organization_name: m.organization_name,
        role: m.role,
      }));
    });

    done();
  },
  { name: 'organization-member-module' },
);
