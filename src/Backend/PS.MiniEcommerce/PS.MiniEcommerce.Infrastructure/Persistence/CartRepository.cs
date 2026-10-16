using Microsoft.EntityFrameworkCore;
using PS.MiniEcommerce.Application.Abstractions.Persistence;
using PS.MiniEcommerce.Domain;

namespace PS.MiniEcommerce.Infrastructure.Persistence;

public class CartRepository : ICartRepository
{
    private readonly AppDbContext _dbContext;

    public CartRepository(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<Cart?> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken)
    {
        return await _dbContext.Carts
            .Include(cart => cart.Items)
            .FirstOrDefaultAsync(cart => cart.UserId == userId, cancellationToken);
    }

    public async Task<Cart> CreateAsync(Guid userId, DateTime utcNow, CancellationToken cancellationToken)
    {
        var cart = Cart.Create(userId, utcNow);
        _dbContext.Carts.Add(cart);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            return cart;
        }
        catch (DbUpdateException exception) when (IsUniqueConstraintViolation(exception))
        {
            _dbContext.Entry(cart).State = EntityState.Detached;

            var existing = await GetByUserIdAsync(userId, cancellationToken);
            if (existing is null)
            {
                throw;
            }

            return existing;
        }
    }

    public async Task<byte[]> GetRowVersionAsync(Guid cartId, CancellationToken cancellationToken)
    {
        return await _dbContext.Carts
            .AsNoTracking()
            .Where(cart => cart.Id == cartId)
            .Select(cart => EF.Property<byte[]>(cart, "RowVersion"))
            .FirstAsync(cancellationToken);
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException exception)
    {
        return exception.InnerException is Microsoft.Data.SqlClient.SqlException sqlException
            && (sqlException.Number == 2601 || sqlException.Number == 2627);
    }
}
