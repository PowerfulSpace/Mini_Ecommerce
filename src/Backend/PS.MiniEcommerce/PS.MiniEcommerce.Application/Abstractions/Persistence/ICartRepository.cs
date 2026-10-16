using PS.MiniEcommerce.Domain;

namespace PS.MiniEcommerce.Application.Abstractions.Persistence;

public interface ICartRepository
{
    Task<Cart?> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken);

    Task<Cart> CreateAsync(Guid userId, DateTime utcNow, CancellationToken cancellationToken);

    Task<byte[]> GetRowVersionAsync(Guid cartId, CancellationToken cancellationToken);
}
